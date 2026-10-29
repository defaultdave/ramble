// Where the seed may run. It fails closed: it runs only when the environment says, in so many words,
// what this database is, and nothing it finds can say otherwise. Local, staging, and load-test refuse
// any production environment and any database that reads as production. Every target but local also
// needs SEED_HOST to name the database host exactly, because a production Neon address carries no
// production word and the shell the runbook uses has no VERCEL_ENV. `production-demo` is the one
// explicit way to seed production, for the Prototype demo: it allows VERCEL_ENV=production and skips
// the production-name and local-host checks (SEED_HOST still applies), and it still refuses
// NODE_ENV=production (the seed never runs inside the deployed app), an unreadable address, and the
// scale fixture.

export const seedTargets = [
  'local',
  'staging',
  'load-test',
  'production-demo',
] as const;
type SeedTarget = (typeof seedTargets)[number];

export type SeedTargetInput = {
  nodeEnv: string;
  vercelEnv: string | undefined;
  /** `SEED_TARGET`. Unset means nobody said what this database is. */
  seedTarget: SeedTarget | undefined;
  databaseUrl: string | undefined;
  /** `SEED_HOST`. Must equal the database URL's host for every target but `local`. */
  seedHost: string | undefined;
};

export type SeedTargetVerdict =
  | { ok: true; target: SeedTarget; host: string }
  | { ok: false; reason: SeedRefusal; message: string };

type SeedRefusal =
  | 'no_database'
  | 'production_runtime'
  | 'target_not_declared'
  | 'scale_on_demo'
  | 'unreadable_database_url'
  | 'address_overridden'
  | 'not_local'
  | 'host_not_confirmed'
  | 'looks_like_production';

const localHosts = ['localhost', '127.0.0.1', '[::1]', '::1', 'postgres'];

// A whole word or a hyphen, dot, or underscore separated part: "prod", "production", "ramble-prod-db",
// but not "product" or "reproduce".
const productionWord = /(^|[^a-z0-9])prod(uction)?($|[^a-z0-9])/i;

const refuse = (reason: SeedRefusal, message: string): SeedTargetVerdict => ({
  ok: false,
  reason,
  message,
});

type ReadUrl =
  | { ok: true; host: string; database: string }
  | { ok: false; verdict: SeedTargetVerdict };

// The driver lets these query parameters replace the address in the URL, so the host and database
// the guard reads from the address would not be the ones the seed connects to. Matched without
// regard to case because the guard must not depend on how the driver spells its keys.
const overridingParameters = ['host', 'hostaddr', 'dbname', 'database'];

const connectionProtocols = ['postgres:', 'postgresql:'];

function readUrl(value: string): ReadUrl {
  if (!URL.canParse(value)) {
    return {
      ok: false,
      verdict: refuse(
        'unreadable_database_url',
        'DATABASE_URL cannot be read.',
      ),
    };
  }
  const url = new URL(value);
  const overrides = [...url.searchParams.keys()].some((key) =>
    overridingParameters.includes(key.toLowerCase()),
  );
  if (overrides) {
    return {
      ok: false,
      verdict: refuse(
        'address_overridden',
        'DATABASE_URL has a host, hostaddr, dbname, or database query parameter. The driver would use it in place of the address, so the seed cannot tell where it would write. Put the host and database in the address.',
      ),
    };
  }
  // The driver decodes percent escapes in the host and the database name; a name that hides a
  // production word behind one would pass the check below, so no escape is accepted. An empty host
  // or database makes the driver fall back to the PG environment variables.
  const database = url.pathname.replace(/^\//, '');
  const readable =
    connectionProtocols.includes(url.protocol) &&
    url.hostname !== '' &&
    database !== '' &&
    !url.hostname.includes('%') &&
    !database.includes('%');
  if (!readable) {
    return {
      ok: false,
      verdict: refuse(
        'unreadable_database_url',
        'DATABASE_URL cannot be read.',
      ),
    };
  }
  return { ok: true, host: url.hostname, database };
}

export type SeedRunOptions = {
  /** The command line asked for the scale fixture (`--scale`). */
  scale: boolean;
};

export function checkSeedTarget(
  input: SeedTargetInput,
  options: SeedRunOptions,
): SeedTargetVerdict {
  const demo = input.seedTarget === 'production-demo';
  if (!input.databaseUrl) {
    return refuse('no_database', 'DATABASE_URL is not set.');
  }
  if (input.nodeEnv === 'production') {
    return refuse(
      'production_runtime',
      'NODE_ENV is production. The seed never runs there.',
    );
  }
  if (input.vercelEnv === 'production' && !demo) {
    return refuse(
      'production_runtime',
      'VERCEL_ENV is production. The seed never runs there unless SEED_TARGET is production-demo.',
    );
  }
  if (!input.seedTarget) {
    return refuse(
      'target_not_declared',
      `SEED_TARGET is not set. Set it to one of ${seedTargets.join(', ')} to say what this database is.`,
    );
  }
  if (demo && options.scale) {
    return refuse(
      'scale_on_demo',
      'SEED_TARGET is production-demo, which takes the curated set only. Run it without --scale.',
    );
  }
  const database = readUrl(input.databaseUrl);
  if (!database.ok) return database.verdict;
  if (
    !demo &&
    (productionWord.test(database.host) ||
      productionWord.test(database.database))
  ) {
    return refuse(
      'looks_like_production',
      `The database ${database.host} looks like a production database. The seed does not run on a name like that.`,
    );
  }
  if (input.seedTarget === 'local' && !localHosts.includes(database.host)) {
    return refuse(
      'not_local',
      `SEED_TARGET is local but the database is on ${database.host}.`,
    );
  }
  if (input.seedTarget !== 'local' && input.seedHost !== database.host) {
    return refuse(
      'host_not_confirmed',
      `SEED_TARGET is ${input.seedTarget} and DATABASE_URL points at ${database.host}. Set SEED_HOST=${database.host} to confirm that is the database to write.`,
    );
  }
  return { ok: true, target: input.seedTarget, host: database.host };
}
