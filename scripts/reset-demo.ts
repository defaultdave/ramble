// `pnpm db:reset --confirm=RESET`. All the work and every decision is in src/server/db/seed and
// src/lib/seed; this file only hands them the environment and the clock.
import { env } from "@/server/env";
import { runResetCommand } from "@/server/db/seed/resetCli";

const code = await runResetCommand({
  argv: process.argv.slice(2),
  target: {
    nodeEnv: env.NODE_ENV,
    vercelEnv: env.VERCEL_ENV,
    seedTarget: env.SEED_TARGET,
    databaseUrl: env.DATABASE_URL,
    seedHost: env.SEED_HOST,
    storageProvider: env.STORAGE_PROVIDER,
  },
  now: new Date(),
  write: (line) => {
    console.log(line);
  },
});
process.exit(code);
