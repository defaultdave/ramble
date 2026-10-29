import 'server-only';
import { curated } from '@/lib/seed/fixtures';
import { parseSeedArgs } from '@/lib/seed/args';
import { describeFailure } from '@/lib/seed/decide';
import {
  combineSeedExits,
  coverageExit,
  photoCoverageLine,
  photosLine,
  refusalLine,
  startLine,
  type SeedExit,
} from '@/lib/seed/outcome';
import { checkSeedTarget, type SeedTargetInput } from '@/lib/seed/target';
import { photoStepFor } from '@/lib/seed/testPhotos';
import type { StorageProviderName } from '@/lib/storage';
import type { StoragePort } from '@/server/ports/storage';
import { db } from '@/server/db/client';
import { seedCaller } from './caller';
import { readPhotoCoverageGaps, seedTestPhotos } from './photos';
import { readSeedSnapshot } from './read';
import { runSeed } from './run';

export type SeedCommand = {
  argv: readonly string[];
  /** The environment as the validated env module read it. */
  target: SeedTargetInput;
  now: Date;
  /** The photo store, opened only when the photo step runs, so a run that skips it needs no Blob token. */
  storage: { provider: StorageProviderName; open: () => StoragePort };
  write: (line: string) => void;
};

async function seedPhotos(command: SeedCommand): Promise<SeedExit | null> {
  const step = photoStepFor(command.storage.provider);
  if (!step.run) {
    command.write(step.line);
    return null;
  }
  const report = await seedTestPhotos(seedCaller, command.storage.open());
  command.write(photosLine(report.created, report.alreadyThere));
  const exit = photoCoverageLine(
    await readPhotoCoverageGaps(seedCaller),
    curated.experiences.length,
  );
  command.write(exit.line);
  return exit;
}

/**
 * The seed command: read the arguments, refuse unless the environment says what this database is
 * and the target allows it, seed, then check the coverage matrix against what the database
 * holds, then give the curated experiences their test photos and check those. Returns the exit
 * code. Nothing touches the database before the refusal check.
 */
export async function runSeedCommand(command: SeedCommand): Promise<number> {
  const { write } = command;
  const args = parseSeedArgs(command.argv);
  if (!args.ok) {
    write(args.message);
    return 2;
  }
  const verdict = checkSeedTarget(command.target, {
    scale: args.scale !== undefined,
  });
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
    return combineSeedExits(exit, await seedPhotos(command));
  } catch (error) {
    write(describeFailure(error));
    return 1;
  } finally {
    await db.$client.end();
  }
}
