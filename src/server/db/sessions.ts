import 'server-only';
import { eq, sql } from 'drizzle-orm';
import {
  GenerateSessionsInputSchema,
  SessionSchema,
  SessionTemplateInputSchema,
  SessionTemplateSchema,
  UpdateSessionAllocationInputSchema,
  checkAllocationChange,
  checkAllocationEditable,
  checkExpectedVersion,
  countAlreadyExisted,
  isBeyondHorizon,
  occurrencesBetween,
  requiresStaff,
  resolveHostZone,
  splitUpcoming,
  type GenerateSessionsInput,
  type Session,
  type SessionTemplate,
  type SessionTemplateInput,
  type UpdateSessionAllocationInput,
} from '@/lib/sessions';
import {
  ForbiddenError,
  Role,
  requireRole,
  type Caller,
} from '@/server/auth/caller';
import { db } from './client';
import { readOpenHeldSeats } from './holds';
import { lockSessionRow } from './locks';
import { experiences, hosts, sessionTemplates, sessions } from './schema';
import { readDatabaseTime } from './time';

type Source = Session['source'];

function isStaff(caller: Caller): boolean {
  return caller.roles.includes(Role.Ops) || caller.roles.includes(Role.Admin);
}

/**
 * Every refusal of a caller who is not staff names the host owner role, whatever the reason, so a
 * missing row, another host's row and a staff-only row cannot be told apart.
 */
function refuse(): never {
  throw new ForbiddenError(Role.HostOwner);
}

/** Called when a row is not there. Staff may learn that; anyone else is refused. */
function refuseUnlessStaff(caller: Caller) {
  if (!isStaff(caller)) refuse();
}

/** Ops and admin may act on any host's sessions. A host owner may act on their own Ramble-sourced capacity. */
function requireSessionEditor(caller: Caller, hostId: string, source: Source) {
  if (isStaff(caller)) return;
  if (requiresStaff(source)) refuse();
  requireRole(caller, Role.HostOwner, { hostId });
}

export type CreateSessionTemplateResult =
  | { ok: true; template: SessionTemplate }
  | { ok: false; reason: 'experience_not_found' | 'duplicate_slot' };

// TODO(U-074c): first caller
/**
 * Adds a weekly slot to an experience. An allocation template is set up by ops; a Ramble template
 * by the experience's host owner or ops. The slot (weekday and start time) is unique per experience.
 */
export async function createSessionTemplate(
  caller: Caller,
  input: SessionTemplateInput,
): Promise<CreateSessionTemplateResult> {
  const data = SessionTemplateInputSchema.parse(input);
  const [experience] = await db
    .select({ hostId: experiences.hostId })
    .from(experiences)
    .where(eq(experiences.id, data.experienceId));
  if (!experience) {
    refuseUnlessStaff(caller);
    return { ok: false, reason: 'experience_not_found' };
  }
  requireSessionEditor(caller, experience.hostId, data.source);
  const [row] = await db
    .insert(sessionTemplates)
    .values(data)
    .onConflictDoNothing({
      target: [
        sessionTemplates.experienceId,
        sessionTemplates.weekday,
        sessionTemplates.startTime,
      ],
    })
    .returning();
  return row
    ? { ok: true, template: SessionTemplateSchema.parse(row) }
    : { ok: false, reason: 'duplicate_slot' };
}

export type GenerateSessionsResult =
  | {
      ok: true;
      /** For `tagsForChange({ kind: 'schedule', experienceId })` in the calling action or job. */
      experienceId: string;
      created: Session[];
      alreadyExisted: number;
      /** Dates in the range whose start is not after `now`. */
      inThePast: number;
    }
  | {
      ok: false;
      reason: 'template_not_found' | 'invalid_time_zone' | 'beyond_horizon';
    };

// TODO(U-068): first caller
/**
 * Creates the template's sessions for the dates from `fromDate` to `toDate` in the host's time zone,
 * and is safe to run again over the same or an overlapping range: a date that already has a session
 * is left as it is, so an edited or cancelled session is never rebuilt. A date whose start is not
 * after `now` is skipped. The range is limited to `maxGenerationDays`, and a `toDate` past
 * `generationHorizon(now)` (see `isBeyondHorizon`) is refused with nothing written.
 */
export async function generateSessions(
  caller: Caller,
  input: GenerateSessionsInput,
  now: Date,
): Promise<GenerateSessionsResult> {
  const data = GenerateSessionsInputSchema.parse(input);
  const [row] = await db
    .select({
      template: sessionTemplates,
      hostId: hosts.id,
      timeZone: hosts.timeZone,
    })
    .from(sessionTemplates)
    .innerJoin(experiences, eq(experiences.id, sessionTemplates.experienceId))
    .innerJoin(hosts, eq(hosts.id, experiences.hostId))
    .where(eq(sessionTemplates.id, data.templateId));
  if (!row) {
    refuseUnlessStaff(caller);
    return { ok: false, reason: 'template_not_found' };
  }
  const template = SessionTemplateSchema.parse(row.template);
  requireSessionEditor(caller, row.hostId, template.source);

  if (isBeyondHorizon(data.toDate, now)) {
    return { ok: false, reason: 'beyond_horizon' };
  }

  const hostZone = resolveHostZone(row.timeZone);
  if (!hostZone.ok) return hostZone;
  const zone = hostZone.zone;

  const occurrences = occurrencesBetween(
    template,
    zone,
    data.fromDate,
    data.toDate,
  );
  const { upcoming, inThePast } = splitUpcoming(occurrences, now);
  if (upcoming.length === 0) {
    return {
      ok: true,
      experienceId: template.experienceId,
      created: [],
      alreadyExisted: 0,
      inThePast,
    };
  }

  const inserted = await db
    .insert(sessions)
    .values(
      upcoming.map((occurrence) => ({
        experienceId: template.experienceId,
        templateId: template.id,
        localDate: occurrence.localDate,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        timeZone: zone,
        allocation: template.allocation,
        source: template.source,
      })),
    )
    .onConflictDoNothing({
      target: [sessions.templateId, sessions.localDate],
    })
    .returning();
  return {
    ok: true,
    experienceId: template.experienceId,
    created: SessionSchema.array().parse(inserted),
    alreadyExisted: countAlreadyExisted(upcoming.length, inserted.length),
    inThePast,
  };
}

export type UpdateSessionAllocationResult =
  | { ok: true; session: Session }
  | {
      ok: false;
      reason:
        | 'session_not_found'
        | 'not_scheduled'
        | 'version_conflict'
        | 'below_sold_and_held';
      seatsSold?: number;
      heldSeats?: number;
    };

// TODO(U-068): first caller
/**
 * Sets a scheduled session's capacity. The caller is checked before the row is locked. Under the
 * lock the row is read again, so a booking that confirms at the same moment is counted, and so
 * are the open holds, judged at database time taken after the lock. The database CHECK on
 * `seats_sold` stays the backstop under it.
 * `expectedVersion` is the version the editor read; a different one means another edit came first.
 */
export async function updateSessionAllocation(
  caller: Caller,
  input: UpdateSessionAllocationInput,
): Promise<UpdateSessionAllocationResult> {
  const data = UpdateSessionAllocationInputSchema.parse(input);
  const [found] = await db
    .select({ source: sessions.source, hostId: experiences.hostId })
    .from(sessions)
    .innerJoin(experiences, eq(experiences.id, sessions.experienceId))
    .where(eq(sessions.id, data.sessionId));
  if (!found) {
    refuseUnlessStaff(caller);
    return { ok: false, reason: 'session_not_found' };
  }
  requireSessionEditor(caller, found.hostId, found.source);

  return db.transaction(async (tx) => {
    const row = await lockSessionRow(tx, data.sessionId);
    if (!row) return { ok: false, reason: 'session_not_found' };
    const current = SessionSchema.parse(row.session);
    requireSessionEditor(caller, row.hostId, current.source);
    const editable = checkAllocationEditable(current.status);
    if (!editable.ok) return editable;
    const version = checkExpectedVersion(current.version, data.expectedVersion);
    if (!version.ok) return version;
    const heldSeats = await readOpenHeldSeats(
      tx,
      current.id,
      await readDatabaseTime(tx),
    );
    const check = checkAllocationChange(
      current.seatsSold,
      heldSeats,
      data.allocation,
    );
    if (!check.ok) return check;
    const [updated] = await tx
      .update(sessions)
      .set({
        allocation: data.allocation,
        version: sql`${sessions.version} + 1`,
      })
      .where(eq(sessions.id, current.id))
      .returning();
    return { ok: true, session: SessionSchema.parse(updated) };
  });
}
