// Local stand-in for U-013: real Postgres (embedded), same SQL as spike.mjs, pg driver only.
// Proves the lock logic and the single-statement variants; says nothing about Neon's drivers or latency.
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import pg from 'pg';

const dir = process.argv[2];
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'spike', password: 'spike', port: 54329, persistent: false });
await server.initialise();
await server.start();
await server.createDatabase('spike');
fs.writeFileSync(new URL('./conn.local.json', import.meta.url), JSON.stringify({
  pooled: 'postgres://spike:spike@localhost:54329/spike', direct: 'postgres://spike:spike@localhost:54329/spike' }));
console.log('postgres up');
process.on('SIGTERM', async () => { await server.stop(); process.exit(0); });
setInterval(() => {}, 1 << 30);
