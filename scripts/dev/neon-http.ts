// `pnpm db:http`. The app reads guest pages through the Neon HTTP driver, which cannot talk to the
// docker-compose Postgres. This serves the same protocol in front of it; set NEON_HTTP_ENDPOINT to
// the address it prints (docs/runbooks/seed.md). Local databases only: it runs any SQL it is sent.
import { startNeonHttpShim } from "../../tests/db/harness";

const localHosts = ["localhost", "127.0.0.1", "[::1]", "postgres"];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  process.exit(1);
}

let host: string;
try {
  host = new URL(databaseUrl).hostname;
} catch {
  console.error("DATABASE_URL is not a valid URL.");
  process.exit(1);
}
if (!localHosts.includes(host)) {
  console.error(
    `Refusing to serve ${host} over HTTP: pnpm db:http is for the local docker-compose database.`,
  );
  process.exit(1);
}

const port = Number(process.env.NEON_HTTP_PORT ?? 4444);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("NEON_HTTP_PORT must be a port number.");
  process.exit(1);
}

const { endpoint, stop } = await startNeonHttpShim(databaseUrl, port);
console.log(`Serving the local database over the Neon HTTP protocol on ${host}.`);
console.log(`Set in .env.local:\n\nNEON_HTTP_ENDPOINT=${endpoint}\n`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void stop().finally(() => process.exit(0));
  });
}
