import type { PlannedSession } from './plan';

/** A seed refusal whose message is safe to print: it names a step or a fixture and never a query, a value, or a URL. */
export class SeedStepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedStepError';
  }
}

/** The session template the seed just wrote is not there to read back. */
export const templateNotFound = (slug: string): SeedStepError =>
  new SeedStepError(`Seed step "find session template" found none for ${slug}`);

/** The singleton settings row is missing, so the snapshot cannot say whether gifts and bookings are on. */
export const settingsRowMissing = (): SeedStepError =>
  new SeedStepError('Seed step "read settings" found no settings row');

// The decisions the seed runner takes while it writes. The runner fetches and persists; each
// answer below comes from here so a unit test can reach it.

const maxCauseDepth = 5;

function codeOf(error: unknown, depth = 0): string | undefined {
  if (depth > maxCauseDepth) return undefined;
  if (typeof error !== 'object' || error === null) return undefined;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  if (typeof code === 'string' && /^[A-Z0-9_]{1,16}$/.test(code)) return code;
  return cause === undefined ? undefined : codeOf(cause, depth + 1);
}

/**
 * What to print when the seed stops. A refusal of its own prints its message. Anything else, such
 * as a database error, prints only the kind and the error code: the message of a driver error
 * carries the SQL and the bound values.
 */
export function describeFailure(error: unknown): string {
  if (error instanceof SeedStepError) return error.message;
  const name = error instanceof Error ? error.name : 'Unknown error';
  const code = codeOf(error);
  return code ? `Seed failed: ${name} (${code})` : `Seed failed: ${name}`;
}

type LegalVersion = {
  id: string;
  version: number;
  status: 'draft' | 'published';
};

export type LegalStep =
  | { action: 'create_and_publish' }
  | { action: 'publish'; id: string }
  | { action: 'skip' };

/**
 * What to do for one legal document. Once any version is published the seed leaves the document
 * alone, so text an owner has revised is never overwritten. A document with no version gets a
 * draft that is then published, because the database refuses a row inserted as published. A
 * document with drafts only (a run that stopped between the two steps) publishes its newest draft
 * rather than starting another.
 */
export function legalSeedStep(versions: readonly LegalVersion[]): LegalStep {
  if (versions.some(({ status }) => status === 'published')) {
    return { action: 'skip' };
  }
  let newest: LegalVersion | undefined;
  for (const candidate of versions) {
    if (!newest || candidate.version > newest.version) newest = candidate;
  }
  return newest
    ? { action: 'publish', id: newest.id }
    : { action: 'create_and_publish' };
}

type StoredCollection = { id: string; slug: string; kind: string };

export type CollectionTarget =
  | { action: 'create' }
  | { action: 'replace'; id: string }
  | { action: 'conflict' };

/** A collection that already has the slug is replaced; one of another kind under that slug is a conflict, never overwritten. */
export function collectionTarget(
  stored: readonly StoredCollection[],
  slug: string,
  kind: string,
): CollectionTarget {
  const same = stored.find((collection) => collection.slug === slug);
  if (!same) return { action: 'create' };
  return same.kind === kind
    ? { action: 'replace', id: same.id }
    : { action: 'conflict' };
}

/**
 * Passes a data-layer answer through when it succeeded and throws when it did not, naming the
 * step and the reason. The seed treats every refusal as a stop: a partial seed is worse than none.
 */
export function expectStatus<
  T extends { status: string },
  S extends T['status'],
>(step: string, outcome: T, success: S): Extract<T, { status: S }> {
  if (outcome.status !== success) {
    throw new SeedStepError(
      `Seed step "${step}" was refused: ${outcome.status}`,
    );
  }
  return outcome as Extract<T, { status: S }>;
}

/** The same for the answers shaped `{ ok: true, ... }` or `{ ok: false, reason }`. */
export function expectOk<T extends { ok: boolean }>(
  step: string,
  outcome: T,
): Extract<T, { ok: true }> {
  if (!outcome.ok) {
    const reason =
      'reason' in outcome && typeof outcome.reason === 'string'
        ? outcome.reason
        : 'no reason given';
    throw new SeedStepError(`Seed step "${step}" was refused: ${reason}`);
  }
  return outcome as Extract<T, { ok: true }>;
}

export function lookup<T>(
  found: ReadonlyMap<string, T>,
  key: string,
  what: string,
): T {
  const value = found.get(key);
  if (value === undefined)
    throw new SeedStepError(`Seed has no ${what} "${key}"`);
  return value;
}

type StoredSession = {
  id: string;
  seatsSold: number;
  weekday: number;
  startTime: string;
  localDate: string | null;
};

const sessionKey = (
  parts: Pick<StoredSession, 'weekday' | 'startTime' | 'localDate'>,
) => `${String(parts.weekday)}|${parts.startTime}|${parts.localDate ?? ''}`;

/** A template that is already there is fine: the seed reruns. Any other refusal stops it. */
export function templateOutcome(
  result: { ok: true } | { ok: false; reason: string },
): void {
  if (result.ok || result.reason === 'duplicate_slot') return;
  throw new SeedStepError(
    `Seed step "create session template" was refused: ${result.reason}`,
  );
}

/** The items in groups of at most `size`, so no write is larger than the bound. */
export function inChunks<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('A chunk holds at least one item');
  }
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/**
 * The seats-sold values to write: planned sessions that exist and have fewer seats sold than the
 * plan says. A session that has sold more than the plan (a real booking) is never lowered.
 */
export function seatUpdates(
  planned: readonly PlannedSession[],
  stored: readonly StoredSession[],
): { sessionId: string; seatsSold: number }[] {
  const byKey = new Map(
    stored.map((session) => [sessionKey(session), session]),
  );
  const updates: { sessionId: string; seatsSold: number }[] = [];
  for (const plan of planned) {
    const session = byKey.get(sessionKey(plan));
    if (session && session.seatsSold < plan.seatsSold) {
      updates.push({ sessionId: session.id, seatsSold: plan.seatsSold });
    }
  }
  return updates;
}
