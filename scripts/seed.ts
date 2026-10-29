// `pnpm db:seed [--scale[=N]] [--scale-seed=N]`. All the work and every decision is in
// src/server/db/seed and src/lib/seed; this file only hands them the environment and the clock.
import { env } from "@/server/env";
import { runSeedCommand } from "@/server/db/seed/cli";
import { getStorage } from "@/server/ports/storage/config";

const now = new Date();
const code = await runSeedCommand({
  argv: process.argv.slice(2),
  target: {
    nodeEnv: env.NODE_ENV,
    vercelEnv: env.VERCEL_ENV,
    seedTarget: env.SEED_TARGET,
    databaseUrl: env.DATABASE_URL,
    seedHost: env.SEED_HOST,
  },
  now,
  storage: {
    provider: env.STORAGE_PROVIDER,
    open: () => getStorage(() => now),
  },
  write: (line) => {
    console.log(line);
  },
});
process.exit(code);
