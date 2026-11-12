import 'server-only';
import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  max,
  sql,
} from 'drizzle-orm';
import { EntityIdSchema } from '@/lib/catalog';
import type { AvailabilityData } from '@/lib/availability';
import { slotAddedEntry, slotSeatsChangedEntry } from '@/lib/experienceAudit';
import {
  AddSlotsInputSchema,
  SessionTemplateSchema,
  UpdateTemplateAllocationInputSchema,
  planTemplateSeatChange,
  resolveHostZone,
  rollingRange,
  type AddSlotsInput,
  type UpdateTemplateAllocationInput,
} from '@/lib/sessions';
import { Role, requireRole, type Caller } from '@/server/auth/caller';
import { updateTagsForChanges } from '@/server/cache/invalidate';
import { systemClock } from '@/server/ports/clock';
import { requireOpsUserId, writeAudit } from './audit';
import { db } from './client';
import { readOpenHeldSeats } from './holds';
import { lockSessionRow } from './locks';
import { experiences, hosts, sessionTemplates, sessions } from './schema';
import { createSessionTemplate, generateSessionsIn } from './sessions';
import { readDatabaseTime } from './time';

// Everything here is for the ops role, and each function checks it before it reads or writes. A
// change is one transaction holding the template, the sessions it moves and its audit row. The
// sessions themselves are made by the generator the rolling job runs, never by code of this file.

/** One experience's weekly slots with how far ahead each is open, or null for an id that is no experience. */
export async function readAvailability(
  caller: Caller,
  experienceId: string,
  now: Date,
): Promise<AvailabilityData | null> {
  requireRole(caller, Role.Ops, {});
  const parsedId = EntityIdSchema.safeParse(experienceId);
  if (!parsedId.success) return null;
  const id = parsedId.data;
  const [experience] = await db
    .select({
      name: experiences.name,
      hostName: hosts.name,
      timeZone: hosts.timeZone,
    })
    .from(experiences)
    .innerJoin(hosts, eq(hosts.id, experiences.hostId))
    .where(eq(experiences.id, id));
  if (!experience) return null;
  const [templates, open] = await Promise.all([
    db
      .select()
      .from(sessionTemplates)
      .where(eq(sessionTemplates.experienceId, id))
      .orderBy(asc(sessionTemplates.weekday), asc(sessionTemplates.startTime)),
    db
      .select({
        templateId: sessions.templateId,
        upcoming: count(),
        lastDate: max(sessions.localDate),
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.experienceId, id),
          eq(sessions.status, 'scheduled'),
          gt(sessions.startsAt, now),
          isNotNull(sessions.templateId),
        ),
      )
      .groupBy(sessions.templateId),
  ]);
  const openBy = new Map(open.map((row) => [row.templateId, row]));
  return {
    experienceId: id,
    experienceName: experience.name,
    hostName: experience.hostName,
    timeZone: experience.timeZone,
    slots: templates.map((row) => {
      const template = SessionTemplateSchema.parse(row);
      const stats = openBy.get(template.id);
      return {
        id: template.id,
        weekday: template.weekday,
        startTime: template.startTime,
        durationMinutes: template.durationMinutes,
        allocation: template.allocation,
        source: template.source,
        upcoming: stats?.upcoming ?? 0,
        lastDate: stats?.lastDate ?? null,
      };
    }),
  };
}

export type AddSlotsResult =
  | { status: 'added'; slots: number; sessionsCreated: number }
  | { status: 'experience_not_found' | 'duplicate_slot' | 'invalid_time_zone' };

class SlotsNotAdded extends Error {
  constructor(readonly status: 'experience_not_found' | 'duplicate_slot') {
    super(status);
  }
}

/**
 * Adds one weekly slot per weekday the input names, then runs the generator over the rolling
 * range for each, so the weeks ahead are bookable at once and the daily job finds them there. Slots,
 * sessions and audit rows are one transaction: a day that already has a slot at that time refuses
 * the whole add, and nothing is written. A host whose time zone is unusable is refused first.
 * A save that opens sessions invalidates the experience's tags after the commit, so this runs in
 * a Server Action only.
 */
export async function addWeeklySlots(
  caller: Caller,
  input: AddSlotsInput,
  now: Date = systemClock.now(),
): Promise<AddSlotsResult> {
  const userId = requireOpsUserId(caller);
  const data = AddSlotsInputSchema.parse(input);
  const range = rollingRange(now);

  const result = await db
    .transaction(async (tx): Promise<AddSlotsResult> => {
      const [host] = await tx
        .select({ timeZone: hosts.timeZone })
        .from(experiences)
        .innerJoin(hosts, eq(hosts.id, experiences.hostId))
        .where(eq(experiences.id, data.experienceId));
      if (!host) return { status: 'experience_not_found' };
      if (!resolveHostZone(host.timeZone).ok) {
        return { status: 'invalid_time_zone' };
      }
      let sessionsCreated = 0;
      for (const weekday of data.weekdays) {
        const slot = await createSessionTemplate(
          caller,
          {
            experienceId: data.experienceId,
            weekday,
            startTime: input.startTime,
            durationMinutes: data.durationMinutes,
            allocation: data.allocation,
            source: data.source,
          },
          tx,
        );
        if (!slot.ok) throw new SlotsNotAdded(slot.reason);
        const generated = await generateSessionsIn(
          tx,
          caller,
          { templateId: slot.template.id, ...range },
          now,
        );
        // The slot was written a moment ago in this transaction, the zone was checked above and the
        // range is the rolling job's, so a refusal here is a fault, not an outcome.
        if (!generated.ok) {
          throw new Error(
            `Opening a new slot was refused: ${generated.reason}`,
          );
        }
        sessionsCreated += generated.created.length;
        await writeAudit(
          tx,
          slotAddedEntry(userId, slot.template, generated.created.length),
        );
      }
      return {
        status: 'added',
        slots: data.weekdays.length,
        sessionsCreated,
      };
    })
    .catch((error: unknown) => {
      if (error instanceof SlotsNotAdded) return { status: error.status };
      throw error;
    });
  // After the commit, so an add that rolled back invalidates nothing.
  if (result.status === 'added' && result.sessionsCreated > 0) {
    updateTagsForChanges([
      { kind: 'experience', experienceId: data.experienceId },
    ]);
  }
  return result;
}

export type UpdateSlotSeatsResult =
  | { status: 'saved'; sessionsUpdated: number }
  | { status: 'unchanged' | 'template_not_found' }
  | { status: 'below_sold_and_held'; booked: number };

type Saved = { result: UpdateSlotSeatsResult; changedSessionIds: string[] };

/**
 * Sets a slot's seat cap. The upcoming scheduled sessions whose capacity still equals the old cap
 * take the new one; a session ops or the host set by hand to another number keeps it, and one that
 * has started or been cancelled is left as it is. The slot and those sessions are locked, the
 * open holds are read at database time taken after the locks, and the change is refused, with
 * nothing written, if any session that would follow it holds more seats sold or held than the new
 * cap. Each session that moves has its version raised, so a host editing it at the same moment
 * meets a conflict instead of overwriting. Runs in a Server Action only.
 */
export async function updateSlotSeats(
  caller: Caller,
  input: UpdateTemplateAllocationInput,
  now: Date = systemClock.now(),
): Promise<UpdateSlotSeatsResult> {
  const userId = requireOpsUserId(caller);
  const data = UpdateTemplateAllocationInputSchema.parse(input);

  const saved = await db.transaction(async (tx): Promise<Saved> => {
    const [row] = await tx
      .select()
      .from(sessionTemplates)
      .where(eq(sessionTemplates.id, data.templateId))
      .for('update');
    if (!row) {
      return {
        result: { status: 'template_not_found' },
        changedSessionIds: [],
      };
    }
    const template = SessionTemplateSchema.parse(row);
    if (template.allocation === data.allocation) {
      return { result: { status: 'unchanged' }, changedSessionIds: [] };
    }
    const candidates = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.templateId, template.id),
          eq(sessions.status, 'scheduled'),
          gt(sessions.startsAt, now),
        ),
      )
      .orderBy(asc(sessions.id));
    // Lock 2, in id order. A row is read again under its lock: a booking that confirmed, or an
    // edit that landed, between the list above and here is seen.
    const locked = [];
    for (const { id } of candidates) {
      const session = (await lockSessionRow(tx, id))?.session;
      if (
        session?.status === 'scheduled' &&
        session.startsAt.getTime() > now.getTime()
      ) {
        locked.push(session);
      }
    }
    const heldAt = await readDatabaseTime(tx);
    const upcoming = [];
    for (const session of locked) {
      upcoming.push({
        id: session.id,
        allocation: session.allocation,
        seatsSold: session.seatsSold,
        heldSeats: await readOpenHeldSeats(tx, session.id, heldAt),
      });
    }
    const plan = planTemplateSeatChange(
      template.allocation,
      data.allocation,
      upcoming,
    );
    if (!plan.ok) {
      return {
        result: { status: 'below_sold_and_held', booked: plan.booked },
        changedSessionIds: [],
      };
    }
    await tx
      .update(sessionTemplates)
      .set({ allocation: data.allocation })
      .where(eq(sessionTemplates.id, template.id));
    if (plan.followIds.length > 0) {
      await tx
        .update(sessions)
        .set({
          allocation: data.allocation,
          version: sql`${sessions.version} + 1`,
        })
        .where(inArray(sessions.id, plan.followIds));
    }
    await writeAudit(
      tx,
      slotSeatsChangedEntry(userId, template, {
        from: template.allocation,
        to: data.allocation,
        sessionsUpdated: plan.followIds.length,
      }),
    );
    return {
      result: { status: 'saved', sessionsUpdated: plan.followIds.length },
      changedSessionIds: plan.followIds,
    };
  });
  // After the commit, so a change that rolled back invalidates nothing.
  updateTagsForChanges(
    saved.changedSessionIds.map((sessionId) => ({ kind: 'spaces', sessionId })),
  );
  return saved.result;
}
