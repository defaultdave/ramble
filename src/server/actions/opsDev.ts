'use server';

import { redirect } from 'next/navigation';
import type { RunOutcome } from '@/lib/jobs';
import { noticeHref } from '@/lib/opsForm';
import {
  devConsoleOpen,
  holdsDevConsoleRole,
  nextClockInstant,
  opsDevPath,
  parseClockForm,
  reportCounts,
  runNoticeHref,
  type OpsDevNoticeCode,
} from '@/lib/opsDev';
import { isResetConfirmed } from '@/lib/seed/resetTarget';
import { chooseDemoClock } from '@/server/demoClock';
import { env } from '@/server/env';
import { resetDemoData } from '@/server/db/seed/reset';
import { drainJobs, runJobById } from '@/server/jobs/drain';
import { callerOrLeave, idOrLeave } from '@/server/opsAccess';
import { readOpsCaller } from '@/server/opsCaller';
import { fixedClock, systemClock, type Clock } from '@/server/ports/clock';
import { runPulse } from '@/server/pulse';
import { readTestClock, writeTestClock } from '@/server/testClock';

// The test-site console's actions. Each refuses first on a production deployment, then for anyone
// without the ops or admin role, and both refusals send the person to the console's page, which
// says so; nothing about the request is read or run. The jobs, the drain and the pulse are the
// ones the schedule uses, run on the real time or on the tester's test clock.

async function guardOrLeave(): Promise<void> {
  if (!devConsoleOpen(env.VERCEL_ENV)) redirect(opsDevPath);
  await callerOrLeave(async () => {
    const caller = await readOpsCaller();
    return holdsDevConsoleRole(caller.roles) ? caller : null;
  }, opsDevPath);
}

/** The test time as the pulse route would take it as `asOf`, or the real time; a time the deployment will not run at goes back to the page with its notice. */
async function clockOrLeave(): Promise<{
  clock: Clock;
  asOf: Date | undefined;
}> {
  const choice = chooseDemoClock(await readTestClock());
  if (!choice.ok) redirect(noticeHref(opsDevPath, clockRefusalNotice(choice)));
  return {
    clock: choice.asOf ? fixedClock(choice.asOf) : systemClock,
    asOf: choice.asOf,
  };
}

function clockRefusalNotice(choice: {
  reason: 'demo-clock-off' | 'out-of-range';
}): OpsDevNoticeCode {
  return choice.reason === 'demo-clock-off'
    ? 'clock_off'
    : 'clock_out_of_range';
}

const runNotices = {
  succeeded: 'run_succeeded',
  retried: 'run_retried',
  dead: 'run_dead',
  lost: 'run_lost',
  not_runnable: 'run_not_runnable',
} as const satisfies Record<RunOutcome | 'not_runnable', OpsDevNoticeCode>;

export async function runOpsJobAction(formData: FormData): Promise<void> {
  await guardOrLeave();
  const id = idOrLeave(formData, 'jobId', opsDevPath);
  const { clock } = await clockOrLeave();
  redirect(noticeHref(opsDevPath, runNotices[await runJobById(id, clock)]));
}

export async function drainOpsJobsAction(): Promise<void> {
  await guardOrLeave();
  const { clock } = await clockOrLeave();
  redirect(runNoticeHref('drained', reportCounts(await drainJobs(clock))));
}

export async function runOpsPulseAction(): Promise<void> {
  await guardOrLeave();
  const { asOf } = await clockOrLeave();
  // A hand-run pulse says nothing about whether the schedule is alive, so it sends no heartbeat.
  redirect(runNoticeHref('pulsed', reportCounts(await runPulse(asOf, false))));
}

export async function setOpsClockAction(formData: FormData): Promise<void> {
  await guardOrLeave();
  const instruction = parseClockForm((name) => formData.get(name));
  if (!instruction.ok) redirect(noticeHref(opsDevPath, 'invalid'));

  const next = nextClockInstant(
    instruction.value,
    (await readTestClock()) ?? null,
    systemClock.now(),
  );
  if (next === null) {
    await writeTestClock(null);
    redirect(noticeHref(opsDevPath, 'clock_reset'));
  }
  const choice = chooseDemoClock(next);
  if (!choice.ok) redirect(noticeHref(opsDevPath, clockRefusalNotice(choice)));
  await writeTestClock(next);
  redirect(noticeHref(opsDevPath, 'clock_set'));
}

export async function resetDemoDataAction(formData: FormData): Promise<void> {
  await guardOrLeave();
  const typed = formData.get('confirm');
  if (typeof typed !== 'string' || !isResetConfirmed(typed)) {
    redirect(noticeHref(opsDevPath, 'reset_unconfirmed'));
  }
  let done = false;
  try {
    await resetDemoData({ now: systemClock.now() });
    done = true;
  } catch (error) {
    // The message can carry a connection detail, so only its kind goes to the log.
    console.error(
      `Demo data reset failed: ${error instanceof Error ? error.name : 'unknown'}`,
    );
  }
  redirect(noticeHref(opsDevPath, done ? 'reset_done' : 'reset_failed'));
}
