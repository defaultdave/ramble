import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  auditLimits,
  parseAuditEntry,
  type AuditEntryInput,
} from '@/lib/audit';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('@/server/monitoring/heartbeat', () => ({ sendHeartbeat: vi.fn() }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Behaviours under test, one per decision, branch or risk:
// The table and its CHECKs (each bad row is refused by the database with the constraint named):
// - a user, a guest, and a system row are accepted; the id is generated and the recording time comes from clock_timestamp()
// - the actor id is present exactly for a user; an unknown actor kind is refused; the subject is required
// - action, subject kind, and details agree with the lib's rules on every case in one table (the database accepts what the lib accepts and nothing else)
// - the largest details the lib accepts are accepted; details over the byte ceiling are refused; a time out of range is refused
// The insert-only guard:
// - UPDATE, DELETE, and TRUNCATE are refused for the owner, and the rows stay
// - audit_writer cannot log in, holds INSERT and SELECT only, can insert and read, and is refused update, delete, and truncate; the role step can run twice
// writeAudit:
// - writes inside the caller's transaction and returns the id; a rollback leaves nothing; a refused entry writes nothing
// The export, against the real table and the fake store:
// - a day holds the rows recorded in [00:00, 24:00) UTC, the boundary instants on the right sides, and no other day
// - rows are paged by id past one page, each exactly once, even when recorded times are out of id order
// - the schedule queues each ready day once from the first row, and the drain exports them through the registry
// - a pulse queues the exports and runs them in the same call, and the next pulse queues nothing new

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let audit: typeof import('@/server/db/audit');
let exporter: typeof import('@/server/jobs/auditExport');
let schedule: typeof import('@/server/jobs/auditSchedule');
let fakeStore: typeof import('@/server/ports/storage/fake');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  vi.stubEnv('PULSE_SECRET', 'p'.repeat(40));
  stopHttp = await serveNeonHttp(fresh.url);
  client = await import('@/server/db/client');
  audit = await import('@/server/db/audit');
  exporter = await import('@/server/jobs/auditExport');
  schedule = await import('@/server/jobs/auditSchedule');
  fakeStore = await import('@/server/ports/storage/fake');
});

afterAll(async () => {
  await stopHttp();
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await client.db.execute(sql`DELETE FROM jobs`);
});

const constraint = (name: string) => ({ cause: { constraint: name } });
const code = (value: string) => ({ cause: { code: value } });
const restricted = code('23001');
const noPrivilege = code('42501');

const user = randomUUID();
const subject = randomUUID();

type Row = Record<string, unknown>;

function valueOf(value: unknown) {
  if (value === null) return sql.raw('NULL');
  if (typeof value === 'object') return sql`${JSON.stringify(value)}::jsonb`;
  return sql`${value}`;
}

function insertRaw(row: Row) {
  const columns = Object.keys(row);
  return client.db.execute(
    sql`INSERT INTO audit_log (${sql.join(
      columns.map((column) => sql.identifier(column)),
      sql`, `,
    )}) VALUES (${sql.join(
      columns.map((column) => valueOf(row[column])),
      sql`, `,
    )})`,
  );
}

/** A user row at the column level. */
const userRow = (over: Row = {}): Row => ({
  actor_kind: 'user',
  actor_id: user,
  action: 'order.cancelled',
  subject_kind: 'order',
  subject_id: subject,
  ...over,
});

async function countRows(where = sql`TRUE`) {
  const { rows } = await client.db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM audit_log WHERE ${where}`,
  );
  return rows[0]?.n;
}

describe('the table', () => {
  it('accepts a user, a guest, and a system row, generates the id, and records the time', async () => {
    await insertRaw(userRow());
    await insertRaw(userRow({ actor_kind: 'guest', actor_id: null }));
    await insertRaw(userRow({ actor_kind: 'system', actor_id: null }));

    const { rows } = await client.db.execute<{
      id: string;
      fresh: boolean;
      details: unknown;
    }>(
      sql`SELECT id::text, (recorded_at > clock_timestamp() - interval '1 minute') AS fresh, details FROM audit_log ORDER BY id`,
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.fresh)).toBe(true);
    expect(rows[0]?.details).toEqual({});
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
  });

  it.each([
    ['a user with no id', { actor_id: null }, 'audit_log_actor_matches_kind'],
    [
      'a guest with an id',
      { actor_kind: 'guest' },
      'audit_log_actor_matches_kind',
    ],
    [
      'a system row with an id',
      { actor_kind: 'system' },
      'audit_log_actor_matches_kind',
    ],
    [
      'a recording time before year 1000',
      { recorded_at: '0999-12-31T00:00:00Z' },
      'audit_log_recorded_at_in_range',
    ],
  ])('refuses %s', async (_label, over, name) => {
    await expect(insertRaw(userRow(over))).rejects.toMatchObject(
      constraint(name),
    );
  });

  it('refuses an unknown actor kind and a missing subject', async () => {
    await expect(
      insertRaw(userRow({ actor_kind: 'robot' })),
    ).rejects.toMatchObject(code('22P02'));
    await expect(
      insertRaw(userRow({ subject_id: null })),
    ).rejects.toMatchObject(code('23502'));
  });

  const nested = { ref: { id: 1 } };
  const tooMany = Object.fromEntries(
    Array.from({ length: 17 }, (_, index) => [`key_${String(index)}`, 1]),
  );
  const maxKeys = Object.fromEntries(
    Array.from({ length: 16 }, (_, index) => [
      `key_${String(index)}`,
      'a'.repeat(100),
    ]),
  );

  // The same cases go to the lib and to the database; they must give the same answer.
  it.each([
    ['empty details', {}, true],
    [
      'mixed scalars',
      { n: 11050, ok: true, none: null, id: 'ord_12:ab.c-d' },
      true,
    ],
    ['a negative integer', { n: -5 }, true],
    ['the largest safe integer', { n: 2 ** 53 - 1 }, true],
    ['16 keys of 100 characters', maxKeys, true],
    ['a key of exactly 40 characters', { [`k${'a'.repeat(39)}`]: 1 }, true],
    ['a name', { guest: 'Ada Lovelace' }, false],
    ['an address', { guest: 'ada@example.com' }, false],
    ['a string of 101 characters', { ref: 'a'.repeat(101) }, false],
    ['an empty string', { ref: '' }, false],
    ['a string starting with a dash', { ref: '-x' }, false],
    ['a nested object', nested, false],
    ['an array value', { ref: [1] }, false],
    ['a fraction', { amount: 10.5 }, false],
    ['an unsafe integer', { amount: 2 ** 53 }, false],
    ['a key with a capital', { Amount: 1 }, false],
    ['a key with a space', { 'a b': 1 }, false],
    ['a key starting with a digit', { '1a': 1 }, false],
    ['a key of 41 characters', { [`k${'a'.repeat(40)}`]: 1 }, false],
    ['17 keys', tooMany, false],
  ])(
    'details with %s: lib and database agree',
    async (_label, details, valid) => {
      const entry = {
        actorKind: 'system',
        action: 'a.b',
        subjectKind: 'k',
        subjectId: subject,
        details,
      } as const;
      const accepted = (() => {
        try {
          parseAuditEntry(entry);
          return true;
        } catch {
          return false;
        }
      })();
      const stored = await insertRaw({
        actor_kind: 'system',
        action: 'a.b',
        subject_kind: 'k',
        subject_id: subject,
        details,
      }).then(
        () => true,
        () => false,
      );

      expect([accepted, stored]).toEqual([valid, valid]);
    },
  );

  it.each([
    ['the details are an array', '[]'],
    ['the details are a string', '"x"'],
  ])('refuses a row when %s', async (_label, json) => {
    await expect(
      client.db.execute(
        sql`INSERT INTO audit_log (actor_kind, action, subject_kind, subject_id, details) VALUES ('system', 'a.b', 'k', ${subject}, ${json}::jsonb)`,
      ),
    ).rejects.toMatchObject(constraint('audit_log_details_shape'));
  });

  it('refuses details over the byte ceiling', async () => {
    const wide = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        `key_${String(index)}`,
        'a'.repeat(100),
      ]),
    );
    await expect(insertRaw(userRow({ details: wide }))).rejects.toMatchObject(
      constraint('audit_log_details_shape'),
    );
  });

  it.each([
    ['one word', 'cancelled'],
    ['a capital', 'Order.cancelled'],
    ['an empty word', 'order..cancelled'],
    ['a trailing dot', 'order.'],
    ['65 characters', `${'a'.repeat(32)}.${'b'.repeat(32)}`],
  ])('refuses an action with %s', async (_label, action) => {
    await expect(insertRaw(userRow({ action }))).rejects.toMatchObject(
      constraint('audit_log_action_shape'),
    );
  });

  it.each([
    ['a dot', 'order.line'],
    ['a capital', 'Order'],
    ['41 characters', 'a'.repeat(41)],
    ['nothing', ''],
  ])('refuses a subject kind with %s', async (_label, subjectKind) => {
    await expect(
      insertRaw(userRow({ subject_kind: subjectKind })),
    ).rejects.toMatchObject(constraint('audit_log_subject_kind_shape'));
  });
});

describe('the insert-only guard', () => {
  async function seeded() {
    const marker = randomUUID();
    await insertRaw(userRow({ subject_id: marker }));
    return marker;
  }

  it('refuses an update, even by the table owner, and the row stays as it was', async () => {
    const marker = await seeded();
    await expect(
      client.db.execute(
        sql`UPDATE audit_log SET action = 'order.changed' WHERE subject_id = ${marker}`,
      ),
    ).rejects.toMatchObject(restricted);
    expect(
      await countRows(
        sql`subject_id = ${marker} AND action = 'order.cancelled'`,
      ),
    ).toBe(1);
  });

  it('refuses a delete, even by the table owner, and the row stays', async () => {
    const marker = await seeded();
    await expect(
      client.db.execute(
        sql`DELETE FROM audit_log WHERE subject_id = ${marker}`,
      ),
    ).rejects.toMatchObject(restricted);
    expect(await countRows(sql`subject_id = ${marker}`)).toBe(1);
  });

  it('refuses a truncate, with or without cascade', async () => {
    await seeded();
    const before = await countRows();
    await expect(
      client.db.execute(sql`TRUNCATE audit_log`),
    ).rejects.toMatchObject(restricted);
    await expect(
      client.db.execute(sql`TRUNCATE audit_log CASCADE`),
    ).rejects.toMatchObject(restricted);
    expect(await countRows()).toBe(before);
  });

  it('has an audit_writer role that cannot log in and holds INSERT and SELECT only', async () => {
    const { rows: roles } = await client.db.execute<{ rolcanlogin: boolean }>(
      sql`SELECT rolcanlogin FROM pg_roles WHERE rolname = 'audit_writer'`,
    );
    expect(roles).toEqual([{ rolcanlogin: false }]);
    const { rows: grants } = await client.db.execute<{
      privilege_type: string;
    }>(
      sql`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee = 'audit_writer' AND table_schema = ${fresh.schema} AND table_name = 'audit_log' ORDER BY privilege_type`,
    );
    expect(grants.map((grant) => grant.privilege_type)).toEqual([
      'INSERT',
      'SELECT',
    ]);
  });

  it('lets audit_writer insert and read, and refuses it update, delete, and truncate', async () => {
    await client.db.execute(
      sql.raw(`GRANT USAGE ON SCHEMA ${fresh.schema} TO audit_writer`),
    );
    const asWriter = (statement: ReturnType<typeof sql>) =>
      client.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE audit_writer`);
        await tx.execute(statement);
      });
    const marker = randomUUID();

    await asWriter(
      sql`INSERT INTO audit_log (actor_kind, action, subject_kind, subject_id) VALUES ('system', 'a.b', 'k', ${marker})`,
    );
    await asWriter(sql`SELECT count(*) FROM audit_log`);

    expect(await countRows(sql`subject_id = ${marker}`)).toBe(1);
    await expect(
      asWriter(sql`UPDATE audit_log SET action = 'x.y'`),
    ).rejects.toMatchObject(noPrivilege);
    await expect(asWriter(sql`DELETE FROM audit_log`)).rejects.toMatchObject(
      noPrivilege,
    );
    await expect(asWriter(sql`TRUNCATE audit_log`)).rejects.toMatchObject(
      noPrivilege,
    );
  });

  it('can create the role a second time without failing, as a second schema or branch would', async () => {
    const step = sql`DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_writer') THEN
          CREATE ROLE audit_writer NOLOGIN;
        END IF;
      EXCEPTION WHEN duplicate_object OR unique_violation THEN
        NULL;
      END
      $$`;
    await client.db.execute(step);
    await client.db.execute(step);
    const { rows } = await client.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'audit_writer'`,
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('writeAudit', () => {
  const entry = (subjectId: string): AuditEntryInput => ({
    actorKind: 'user',
    actorId: user.toUpperCase(),
    action: 'refund.requested',
    subjectKind: 'refund',
    subjectId,
    details: { amount_minor: 500 },
  });

  it('writes the row in the caller transaction, lower-cases the ids, and returns the id', async () => {
    const marker = randomUUID();

    const written = await client.db.transaction((tx) =>
      audit.writeAudit(tx, entry(marker)),
    );

    const { rows } = await client.db.execute<{
      id: string;
      actor_id: string;
      details: unknown;
    }>(
      sql`SELECT id::text, actor_id::text, details FROM audit_log WHERE subject_id = ${marker}`,
    );
    expect(rows).toEqual([
      {
        id: String(written.id),
        actor_id: user,
        details: { amount_minor: 500 },
      },
    ]);
  });

  it('leaves nothing when the caller rolls back', async () => {
    const marker = randomUUID();

    await expect(
      client.db.transaction(async (tx) => {
        await audit.writeAudit(tx, entry(marker));
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');

    expect(await countRows(sql`subject_id = ${marker}`)).toBe(0);
  });

  it('writes nothing for an entry the lib refuses', async () => {
    const marker = randomUUID();

    await expect(
      client.db.transaction((tx) =>
        audit.writeAudit(tx, {
          ...entry(marker),
          details: { guest: 'ada@example.com' },
        }),
      ),
    ).rejects.toThrow();

    expect(await countRows(sql`subject_id = ${marker}`)).toBe(0);
  });
});

describe('the export', () => {
  const day = '2020-03-10';
  const window = {
    from: new Date(`${day}T00:00:00Z`),
    to: new Date('2020-03-11T00:00:00Z'),
  };
  const ids = async (page: Promise<{ id: number }[]>) =>
    (await page).map((row) => row.id);

  async function insertAt(recordedAt: string, marker: string) {
    const { rows } = await client.db.execute<{ id: string }>(
      sql`INSERT INTO audit_log (recorded_at, actor_kind, action, subject_kind, subject_id) VALUES (${recordedAt}, 'system', 'a.b', 'k', ${marker}) RETURNING id::text`,
    );
    return Number(rows[0]?.id);
  }

  it('reads the day half open at both ends and no other day', async () => {
    const marker = randomUUID();
    await insertAt('2020-03-09T23:59:59.999999Z', marker);
    const first = await insertAt('2020-03-10T00:00:00Z', marker);
    const last = await insertAt('2020-03-10T23:59:59.999999Z', marker);
    await insertAt('2020-03-11T00:00:00Z', marker);

    const page = await ids(audit.readAuditPage(window, 0, 100));

    expect(page).toEqual([first, last]);
  });

  it('pages by id past one page, each row once, even when recorded times are out of id order', async () => {
    const total = auditLimits.exportPageRows + 3;
    await client.db.execute(
      sql`INSERT INTO audit_log (recorded_at, actor_kind, action, subject_kind, subject_id)
        SELECT '2020-04-02T00:00:00Z'::timestamptz + ((${total} - g) * interval '1 second'), 'system', 'a.b', 'k', ${randomUUID()}
        FROM generate_series(1, ${total}) AS g`,
    );
    const april = {
      from: new Date('2020-04-02T00:00:00Z'),
      to: new Date('2020-04-03T00:00:00Z'),
    };
    const seen: number[] = [];
    let afterId = 0;
    for (;;) {
      const page = await ids(
        audit.readAuditPage(april, afterId, auditLimits.exportPageRows),
      );
      seen.push(...page);
      afterId = page.at(-1) ?? afterId;
      if (page.length < auditLimits.exportPageRows) break;
    }

    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('exports a real day to the store, manifest last, and a second run changes nothing', async () => {
    const marker = randomUUID();
    const a = await insertAt('2020-05-01T08:00:00Z', marker);
    const b = await insertAt('2020-05-01T09:00:00Z', marker);
    const storage = fakeStore.createFakeStorageAdapter({
      now: () => new Date(),
    });

    const tally = await exporter.exportAuditDay({ day: '2020-05-01' }, storage);
    const again = await exporter.exportAuditDay({ day: '2020-05-01' }, storage);

    expect(tally).toEqual({ parts: 1, rows: 2, firstId: a, lastId: b });
    expect(again).toEqual(tally);
    const part = new TextDecoder().decode(
      storage.read('audit/2020-05-01/part-0001.ndjson') ?? new Uint8Array(),
    );
    expect(
      part
        .trim()
        .split('\n')
        .map((line) => (JSON.parse(line) as { id: number }).id),
    ).toEqual([a, b]);
    expect(storage.read('audit/2020-05-01/manifest.ndjson')).not.toBeNull();
  });

  it('queues each ready day once from the first row, and the drain exports them through the registry', async () => {
    // The first row in this file is dated 2020, far outside the lookback, so exactly the lookback is queued.
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2020-06-01T12:00:00Z'),
    });
    let queued: number;
    let again: number;
    try {
      queued = await schedule.scheduleAuditExports();
      again = await schedule.scheduleAuditExports();
    } finally {
      vi.useRealTimers();
    }

    expect([queued, again]).toEqual([auditLimits.exportLookbackDays, 0]);
    const { rows: queuedJobs } = await client.db.execute<{
      kind: string;
      dedupe_key: string;
    }>(sql`SELECT kind, dedupe_key FROM jobs ORDER BY dedupe_key`);
    expect(queuedJobs.map((job) => [job.kind, job.dedupe_key])).toEqual(
      ['25', '26', '27', '28', '29', '30', '31'].map((date) => [
        'audit-export',
        `audit-export:2020-05-${date}`,
      ]),
    );

    const { drainJobs } = await import('@/server/jobs/drain');
    const { systemClock } = await import('@/server/ports/clock');
    const report = await drainJobs(systemClock);

    expect(report).toMatchObject({ claimed: 7, succeeded: 7, dead: 0 });
    const { getStorage } = await import('@/server/ports/storage/config');
    const store = getStorage(() => new Date()) as ReturnType<
      typeof fakeStore.createFakeStorageAdapter
    >;
    expect(store.read('audit/2020-05-31/manifest.ndjson')).not.toBeNull();
  });
});

describe('the pulse', () => {
  const pulseCall = async () => {
    const { pulseResponse } = await import('@/server/pulse');
    const response = await pulseResponse(
      new Request('http://localhost/api/pulse', {
        method: 'POST',
        headers: { authorization: `Bearer ${'p'.repeat(40)}` },
      }),
    );
    return {
      status: response.status,
      counts: (await response.json()) as Record<string, number>,
    };
  };

  it('queues the exports and runs them in the same call, and the next pulse queues nothing new', async () => {
    const first = await pulseCall();
    const second = await pulseCall();

    // Six or seven days, by whether yesterday's grace hour has passed.
    expect(first.status).toBe(200);
    expect(first.counts.claimed).toBeGreaterThanOrEqual(
      auditLimits.exportLookbackDays - 1,
    );
    expect(first.counts).toMatchObject({
      succeeded: first.counts.claimed,
      dead: 0,
      retried: 0,
    });
    expect(second.counts.claimed).toBe(0);
  });
});
