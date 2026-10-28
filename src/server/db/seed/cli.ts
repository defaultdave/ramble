import 'server-only';
import { parseSeedArgs } from '@/lib/seed/args';
import { evaluateCoverage, coverageGaps } from '@/lib/seed/coverage';
import { describeFailure } from '@/lib/seed/decide';
import { checkSeedTarget, type SeedTargetInput } from '@/lib/seed/target';
import { db } from '@/server/db/client';
import { readSeedSnapshot } from './read';
import { runSeed } from './run';

export type SeedCommand = {
  argv: readonly string[];
  /** The environment as the validated env module read it. */
  target: SeedTargetInput;
  now: Date;
  write: (line: string) => void;
};

/**
 * The seed command: read the arguments, refuse unless the environment says this is a local,
 * staging, or load-test database, seed, then check the coverage matrix against what the database
 * holds. Returns the exit code. Nothing touches the database before the refusal check.
 */
export async function runSeedCommand(command: SeedCommand): Promise<number> {
  const { write } = command;
  const args = parseSeedArgs(command.argv);
  if (!args.ok) {
    write(args.message);
    return 2;
  }
  const verdict = checkSeedTarget(command.target);
  if (!verdict.ok) {
    write(`Refusing to seed: ${verdict.message}`);
    return 1;
  }
  write(`Seeding the ${verdict.target} database on ${verdict.host}`);
  try {
    await runSeed({ now: command.now, scale: args.scale, log: write });
    const results = evaluateCoverage(await readSeedSnapshot(command.now), {
      scale: args.scale !== undefined,
    });
    const gaps = coverageGaps(results);
    if (gaps.length > 0) {
      write(`Seeded, but the coverage matrix has gaps: ${gaps.join(', ')}`);
      return 1;
    }
    write(`Coverage matrix: ${String(results.length)} probes checked, no gaps`);
    return 0;
  } catch (error) {
    write(describeFailure(error));
    return 1;
  } finally {
    await db.$client.end();
  }
}
