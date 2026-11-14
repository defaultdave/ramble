import { z } from 'zod';
import type { DrainReport, JobStatus } from './jobs';
import {
  formText,
  formWholeNumber,
  invalidFormNotice,
  type FormGetter,
  type FormResult,
  type NoticeText,
} from './opsForm';
import { pickKnown } from './pickKnown';
import type { StatusTone } from './statusBadge';
import { tableHref } from './tableQuery';

// The test-site console: what its page and actions share. It exists for testers on a deployment
// where nothing runs the pulse by itself, and it is closed on a production deployment.

export const opsDevPath = '/ops/dev';
export const devClockCookieName = 'ramble_dev_clock';
export const devClockCookieMaxAgeSeconds = 8 * 60 * 60;

/** Ops and admin may use the console. Every other ops page is for ops alone; this one is a tester's tool, so admin is let in. */
export function holdsDevConsoleRole(roles: readonly string[]): boolean {
  return roles.includes('ops') || roles.includes('admin');
}

/** Whether the console may do anything: everywhere but a production deployment, where `VERCEL_ENV` says so. */
export function devConsoleOpen(vercelEnv: string | undefined): boolean {
  return vercelEnv !== 'production';
}

const unitMilliseconds = { hours: 3_600_000, days: 86_400_000 } as const;
export const clockUnits = ['hours', 'days'] as const;
type ClockUnit = (typeof clockUnits)[number];

export type ClockInstruction =
  | { kind: 'set'; at: Date }
  | { kind: 'advance'; by: number; unit: ClockUnit }
  | { kind: 'reset' };

const IsoInstantSchema = z.iso.datetime({ offset: true }).max(40);
// What a datetime-local input posts: no zone, read as UTC.
const localInstantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const advanceMax = 9999;

function parseInstant(raw: string | undefined): Date | null {
  if (raw === undefined) return null;
  const text = localInstantPattern.test(raw) ? `${raw}:00Z` : raw;
  const parsed = IsoInstantSchema.safeParse(text);
  return parsed.success ? new Date(parsed.data) : null;
}

/** The instruction a posted clock form carries, or not ok for one that names none or a bad value. */
export function parseClockForm(get: FormGetter): FormResult<ClockInstruction> {
  const intent = formText(get, 'intent');
  if (intent === 'reset') return { ok: true, value: { kind: 'reset' } };
  if (intent === 'set') {
    const at = parseInstant(formText(get, 'at'));
    return at === null
      ? { ok: false }
      : { ok: true, value: { kind: 'set', at } };
  }
  if (intent === 'advance') {
    const by = formWholeNumber(get, 'amount');
    const unit = pickKnown(formText(get, 'unit') ?? '', clockUnits, null);
    return by === undefined || by < 1 || by > advanceMax || unit === null
      ? { ok: false }
      : { ok: true, value: { kind: 'advance', by, unit } };
  }
  return { ok: false };
}

/**
 * The test clock an instruction leaves: a set time, the current test time (or the real one when
 * none is set) moved on, or null for no test clock at all.
 */
export function nextClockInstant(
  instruction: ClockInstruction,
  current: Date | null,
  realNow: Date,
): Date | null {
  if (instruction.kind === 'reset') return null;
  if (instruction.kind === 'set') return instruction.at;
  const from = current ?? realNow;
  return new Date(
    from.getTime() + instruction.by * unitMilliseconds[instruction.unit],
  );
}

/** The test time a cookie holds, or null for none or a value that is not a time. */
export function parseStoredClock(raw: string | undefined): Date | null {
  return parseInstant(raw);
}

/** A time as the console shows it: always UTC, so it reads the same for every tester. */
export function utcLabel(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

const statusTones = {
  pending: 'info',
  running: 'warning',
  succeeded: 'success',
  dead: 'danger',
} as const satisfies Record<JobStatus, StatusTone>;

const statusLabels = {
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Succeeded',
  dead: 'Dead',
} as const satisfies Record<JobStatus, string>;

export type OpsJobInput = {
  id: string;
  kind: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  lastError: string | null;
};

export type OpsJobRow = {
  id: string;
  kind: string;
  statusLabel: string;
  tone: StatusTone;
  attemptsLabel: string;
  runAfterLabel: string;
  lastError: string | null;
  /** Only a waiting job can be run by hand; a running one is held by a drain, a finished one is done. */
  runnable: boolean;
};

export function buildOpsJobRow(job: OpsJobInput): OpsJobRow {
  return {
    id: job.id,
    kind: job.kind,
    statusLabel: statusLabels[job.status],
    tone: statusTones[job.status],
    attemptsLabel: `${String(job.attempts)} of ${String(job.maxAttempts)}`,
    runAfterLabel: utcLabel(job.runAfter),
    lastError: job.lastError,
    runnable: job.status === 'pending',
  };
}

export const opsDevNoticeCodes = [
  'invalid',
  'run_succeeded',
  'run_retried',
  'run_dead',
  'run_lost',
  'run_not_runnable',
  'drained',
  'pulsed',
  'clock_set',
  'clock_reset',
  'clock_off',
  'clock_out_of_range',
] as const;
export type OpsDevNoticeCode = (typeof opsDevNoticeCodes)[number];

export const opsDevNotices = {
  invalid: invalidFormNotice,
  run_succeeded: { tone: 'success', title: 'The job ran and succeeded.' },
  run_retried: {
    tone: 'warning',
    title: 'The job failed and was queued to try again.',
  },
  run_dead: {
    tone: 'danger',
    title: 'The job failed on its last attempt and is dead.',
  },
  run_lost: {
    tone: 'warning',
    title: 'Another run took the job first. Nothing was run here.',
  },
  run_not_runnable: {
    tone: 'warning',
    title: 'That job is not waiting, so it was not run.',
  },
  drained: { tone: 'success', title: 'The queue was drained.' },
  pulsed: { tone: 'success', title: 'The pulse ran.' },
  clock_set: { tone: 'success', title: 'The test clock is set.' },
  clock_reset: {
    tone: 'success',
    title: 'The test clock is off. Runs use the real time.',
  },
  clock_off: {
    tone: 'warning',
    title:
      'The demo clock is switched off on this deployment (DEMO_CLOCK), so a test time cannot be used. Reset the clock to run at the real time.',
  },
  clock_out_of_range: {
    tone: 'warning',
    title: 'That time is more than 400 days from now. Pick a nearer one.',
  },
} as const satisfies Record<OpsDevNoticeCode, NoticeText>;

/** What the console shows of a run's counts. Each is a whole number in the address, so no text rides in a link. */
const reportFields = [
  'claimed',
  'succeeded',
  'retried',
  'dead',
  'lost',
  'left',
  'holdsReleased',
  'sessionsCreated',
] as const;
type ReportField = (typeof reportFields)[number];

const reportLabels = {
  claimed: 'claimed',
  succeeded: 'succeeded',
  retried: 'retried',
  dead: 'dead',
  lost: 'lost',
  left: 'still due',
  holdsReleased: 'holds released',
  sessionsCreated: 'sessions created',
} as const satisfies Record<ReportField, string>;

/** The address a run ends on: its notice, and the counts the run produced. */
export function runNoticeHref(
  code: OpsDevNoticeCode,
  counts: Partial<Record<ReportField, number>> = {},
): string {
  const params: Record<string, string> = { notice: code };
  for (const field of reportFields) {
    const value = counts[field];
    if (value !== undefined) params[field] = String(value);
  }
  return tableHref(opsDevPath, params);
}

export type RunCounts = DrainReport & {
  holdsReleased?: number;
  sessionsCreated?: number;
};

/** The counts a run reports, in the order the console lists them. */
export function reportCounts(
  counts: RunCounts,
): Partial<Record<ReportField, number>> {
  const shown: Partial<Record<ReportField, number>> = {};
  for (const field of reportFields) {
    const value = counts[field];
    if (value !== undefined) shown[field] = value;
  }
  return shown;
}

/** One line for the counts an address carries, or null when it carries none. */
export function reportLine(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
): string | null {
  const parts: string[] = [];
  for (const field of reportFields) {
    const raw = query[field];
    if (typeof raw === 'string' && /^\d{1,7}$/.test(raw)) {
      parts.push(`${raw} ${reportLabels[field]}`);
    }
  }
  return parts.length === 0 ? null : parts.join(', ');
}
