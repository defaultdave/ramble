import 'server-only';
import { parseSeedArgs } from '@/lib/seed/args';
import { describeFailure } from '@/lib/seed/decide';
import { coverageExit, refusalLine, startLine } from '@/lib/seed/outcome';
import { checkSeedTarget, type SeedTargetInput } from '@/lib/seed/target';
import { db } from '@/server/db/client';
import { seedCaller } from './caller';
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
    write(refusalLine(verdict));
    return 1;
  }
  write(startLine(verdict));
  try {
    await runSeed({
      caller: seedCaller,
      now: command.now,
      scale: args.scale,
      log: write,
    });
    const exit = coverageExit(
      await readSeedSnapshot(seedCaller, command.now),
      args.scale,
    );
    write(exit.line);
    return exit.code;
  } catch (error) {
    write(describeFailure(error));
    return 1;
  } finally {
    await db.$client.end();
  }
}
