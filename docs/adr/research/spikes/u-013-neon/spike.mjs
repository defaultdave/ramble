// U-013: reserve path under the session-row lock on Neon.
// Reads conn.local.json: { "pooled": "postgres://...-pooler...", "direct": "postgres://..." }
// Run: bun spike.mjs [rounds] [attempts]
import fs from 'node:fs';
import pg from 'pg';
import ws from 'ws';
import { neon, neonConfig, Pool as NeonPool } from '@neondatabase/serverless';

neonConfig.webSocketConstructor = ws;
const conn = JSON.parse(fs.readFileSync(new URL('./conn.local.json', import.meta.url)));
const ROUNDS = Number(process.argv[2] ?? 5);
const ATTEMPTS = Number(process.argv[3] ?? 60);
const SESSIONS = [1, 2, 3];
const CAPACITY = 10;

// Deterministic party sizes: 1 to 3, same sequence every round and variant.
const parties = Array.from({ length: ATTEMPTS }, (_, i) => 1 + ((i * 7 + 3) % 3));
const sessionFor = (i) => SESSIONS[i % SESSIONS.length];

const admin = new pg.Pool({ connectionString: conn.direct, max: 2 });
await admin.query(`
  create table if not exists spike_sessions (id int primary key, capacity int not null, taken int not null default 0);
  create table if not exists spike_holds (id bigserial primary key, session_id int not null, party int not null, created_at timestamptz default now());
`);
async function reset() {
  await admin.query('truncate spike_holds');
  await admin.query('delete from spike_sessions');
  for (const id of SESSIONS) await admin.query('insert into spike_sessions (id, capacity) values ($1,$2)', [id, CAPACITY]);
}
async function audit() {
  const { rows } = await admin.query(`
    select s.id, s.capacity, coalesce(sum(h.party),0)::int as held, count(h.id)::int as holds
    from spike_sessions s left join spike_holds h on h.session_id = s.id group by s.id, s.capacity order by s.id`);
  return rows;
}

// Interactive transaction: lock the session row, read taken spaces, insert if it fits.
const lockedTx = (pool) => async (sessionId, party) => {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const s = await c.query('select capacity from spike_sessions where id = $1 for update', [sessionId]);
    const t = await c.query('select coalesce(sum(party),0)::int as held from spike_holds where session_id = $1', [sessionId]);
    if (t.rows[0].held + party <= s.rows[0].capacity) {
      await c.query('insert into spike_holds (session_id, party) values ($1,$2)', [sessionId, party]);
      await c.query('commit');
      return true;
    }
    await c.query('commit');
    return false;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
};

const LOCAL = conn.direct.includes('localhost');
// One autocommit statement per call: Neon's HTTP driver in production, a pg pool locally.
const localPool = LOCAL ? new pg.Pool({ connectionString: conn.direct, max: 20 }) : null;
const httpDb = LOCAL ? null : neon(conn.direct, { fullResults: false });
const one = (text, params) => (LOCAL ? localPool.query(text, params).then((r) => r.rows) : httpDb.query(text, params));
const variants = {};
const variantsPool = new pg.Pool({ connectionString: conn.direct, max: 20 });
{
  const p = new pg.Pool({ connectionString: conn.pooled, max: 20 });
  variants['pg + pooler (transaction)'] = { run: lockedTx(p), close: () => p.end() };
}
{
  const p = new pg.Pool({ connectionString: conn.direct, max: 20 });
  variants['pg + direct host (transaction)'] = { run: lockedTx(p), close: () => p.end() };
}
if (!LOCAL) {
  const p = new NeonPool({ connectionString: conn.pooled, max: 20 });
  variants['neon WebSocket Pool + pooler (transaction)'] = { run: lockedTx(p), close: () => p.end() };
}
variants[(LOCAL ? 'pg autocommit' : 'neon HTTP') + ', one statement, lock + sum subquery'] = {
  run: async (id, party) => {
    const r = await one(`
      with s as (select id, capacity from spike_sessions where id = $1 for update)
      insert into spike_holds (session_id, party)
      select s.id, $2::int from s
      where (select coalesce(sum(party),0) from spike_holds where session_id = s.id) + $2::int <= s.capacity
      returning id`, [id, party]);
    return r.length === 1;
  },
  close: async () => {},
};
variants[(LOCAL ? 'pg autocommit' : 'neon HTTP') + ', one statement, counter column'] = {
  run: async (id, party) => {
    const r = await one(`
      with u as (update spike_sessions set taken = taken + $2::int where id = $1 and taken + $2::int <= capacity returning id)
      insert into spike_holds (session_id, party) select id, $2::int from u returning id`, [id, party]);
    return r.length === 1;
  },
  close: async () => {},
};

variants['pg transaction, NO lock (control)'] = {
  run: async (id, party) => {
    const c = await variantsPool.connect();
    try {
      await c.query('begin');
      const s = await c.query('select capacity from spike_sessions where id = $1', [id]);
      const t = await c.query('select coalesce(sum(party),0)::int as held from spike_holds where session_id = $1', [id]);
      if (t.rows[0].held + party <= s.rows[0].capacity) { await c.query('insert into spike_holds (session_id, party) values ($1,$2)', [id, party]); await c.query('commit'); return true; }
      await c.query('commit'); return false;
    } finally { c.release(); }
  },
  close: () => variantsPool.end(),
};
const pct = (a, q) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))];
const results = [];
for (const [name, v] of Object.entries(variants)) {
  // warm connections and the HTTP path once
  await reset();
  await Promise.all(Array.from({ length: 30 }, (_, i) => v.run(SESSIONS[i % 3], 1).catch(() => {}))); // fills the 20-connection pool
  const rounds = [];
  for (let r = 0; r < ROUNDS; r++) {
    await reset();
    const lat = [];
    let errors = 0, accepted = 0;
    const t0 = performance.now();
    await Promise.all(parties.map(async (party, i) => {
      const s = performance.now();
      try { if (await v.run(sessionFor(i), party)) accepted++; }
      catch (e) { errors++; lat.errMsg = e.message; }
      lat.push(performance.now() - s);
    }));
    const wall = performance.now() - t0;
    const rows = await audit();
    const oversold = rows.filter((x) => x.held > x.capacity);
    rounds.push({ accepted, errors, wallMs: Math.round(wall), p50: Math.round(pct(lat, 0.5)), p95: Math.round(pct(lat, 0.95)), maxHeld: Math.max(...rows.map((x) => x.held)), oversoldSessions: oversold.length, overBy: oversold.reduce((a, x) => a + x.held - x.capacity, 0), errMsg: lat.errMsg });
  }
  await v.close();
  const sum = (k) => rounds.reduce((a, r) => a + r[k], 0);
  results.push({ name, rounds: ROUNDS, attempts: ATTEMPTS, oversoldRounds: rounds.filter((r) => r.oversoldSessions > 0).length, totalOverBy: sum('overBy'), errors: sum('errors'), medianP50: pct(rounds.map((r) => r.p50), 0.5), medianP95: pct(rounds.map((r) => r.p95), 0.5), medianWall: pct(rounds.map((r) => r.wallMs), 0.5), rounds });
  console.log(name, JSON.stringify({ oversoldRounds: results.at(-1).oversoldRounds, totalOverBy: results.at(-1).totalOverBy, errors: results.at(-1).errors, p50: results.at(-1).medianP50, p95: results.at(-1).medianP95, wall: results.at(-1).medianWall }));
}
fs.writeFileSync(new URL('./results.local.json', import.meta.url), JSON.stringify(results, null, 2));
await admin.query('drop table spike_holds; drop table spike_sessions;');
await admin.end();
if (localPool) await localPool.end();
