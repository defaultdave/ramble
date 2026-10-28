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

function readUrl(
  value: string,
): { host: string; database: string } | undefined {
  try {
    const url = new URL(value);
    return {
      host: url.hostname,
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    };
  } catch {
    return undefined;
  }
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
  if (!database) {
    return refuse('unreadable_database_url', 'DATABASE_URL cannot be read.');
  }
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
