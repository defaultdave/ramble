// Where the seed may run. It fails closed: it runs only when the environment says, in so many words,
// that this is a local, staging, or load-test database, and nothing it finds can say otherwise.

export const seedTargets = ['local', 'staging', 'load-test'] as const;
type SeedTarget = (typeof seedTargets)[number];

export type SeedTargetInput = {
  nodeEnv: string;
  vercelEnv: string | undefined;
  /** `SEED_TARGET`. Unset means nobody said what this database is. */
  seedTarget: SeedTarget | undefined;
  databaseUrl: string | undefined;
};

export type SeedTargetVerdict =
  | { ok: true; target: SeedTarget; host: string }
  | { ok: false; reason: SeedRefusal; message: string };

type SeedRefusal =
  | 'no_database'
  | 'production_runtime'
  | 'target_not_declared'
  | 'unreadable_database_url'
  | 'address_overridden'
  | 'not_local'
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

export function checkSeedTarget(input: SeedTargetInput): SeedTargetVerdict {
  if (!input.databaseUrl) {
    return refuse('no_database', 'DATABASE_URL is not set.');
  }
  if (input.nodeEnv === 'production') {
    return refuse(
      'production_runtime',
      'NODE_ENV is production. The seed never runs there.',
    );
  }
  if (input.vercelEnv === 'production') {
    return refuse(
      'production_runtime',
      'VERCEL_ENV is production. The seed never runs there.',
    );
  }
  if (!input.seedTarget) {
    return refuse(
      'target_not_declared',
      `SEED_TARGET is not set. Set it to one of ${seedTargets.join(', ')} to say what this database is.`,
    );
  }
  const database = readUrl(input.databaseUrl);
  if (!database.ok) return database.verdict;
  if (
    productionWord.test(database.host) ||
    productionWord.test(database.database)
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
  return { ok: true, target: input.seedTarget, host: database.host };
}
