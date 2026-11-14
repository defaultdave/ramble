import 'server-only';
import { describeFailure } from '@/lib/seed/decide';
import { refusalLine } from '@/lib/seed/outcome';
import {
  isResetConfirmed,
  resetConfirmPhrase,
  resetRefusal,
} from '@/lib/seed/resetTarget';
import { checkSeedTarget, type SeedTargetInput } from '@/lib/seed/target';
import { db } from '@/server/db/client';
import { resetDemoData } from './reset';

export type ResetCommand = {
  argv: readonly string[];
  /** The environment as the validated env module read it. */
  target: SeedTargetInput;
  now: Date;
  write: (line: string) => void;
};

const confirmFlag = '--confirm=';

const usage = `This empties orders, holds, gifts, messages and jobs, then reruns the seed. Run it again with ${confirmFlag}${resetConfirmPhrase} to go ahead.`;

/**
 * The reset command: refuse unless the arguments carry the confirmation phrase, then refuse unless
 * this is not production and the environment says what the database is (the seed's own check),
 * then reset. Returns the exit code. Nothing touches the database before both refusals.
 */
export async function runResetCommand(command: ResetCommand): Promise<number> {
  const { write } = command;
  const typed = command.argv
    .find((arg) => arg.startsWith(confirmFlag))
    ?.slice(confirmFlag.length);
  if (!isResetConfirmed(typed)) {
    write(usage);
    return 2;
  }
  const refusal = resetRefusal(command.target);
  if (refusal !== null) {
    write(refusal);
    return 1;
  }
  const verdict = checkSeedTarget(command.target, { scale: false });
  if (!verdict.ok) {
    write(refusalLine(verdict));
    return 1;
  }
  try {
    await resetDemoData({ now: command.now, log: write });
    write('Demo data reset');
    return 0;
  } catch (error) {
    write(describeFailure(error));
    return 1;
  } finally {
    await db.$client.end();
  }
}
