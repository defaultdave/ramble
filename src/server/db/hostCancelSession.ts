import 'server-only';
import { and, eq } from 'drizzle-orm';
import { WriteIdSchema } from '@/lib/catalog';
import type { HostCancelData } from '@/lib/hostCancelSession';
import {
  cancelBlocked,
  cancelGate,
  impactIsCurrent,
  type ImpactFormInput,
  type OpsCancelOutcome,
} from '@/lib/opsSessions';
import { requireRole, Role, type Caller } from '@/server/auth/caller';
import { cancelSession } from './cancelSession';
import { db } from './client';
import { experiences, sessions } from './schema';
import { readImpact } from './sessionImpact';
import { currentDatabaseTime } from './time';

// A host owner cancelling a booked session of their own host (PRD-41). Only the owner of the host
// the session belongs to may read or do it: staff, ops, admin, another host's owner, a guest and
// nobody are refused (ops cancels from its own page). A session that is missing, or another host's,
// reads as nothing, so the two look alike. The cancelling itself is `cancelSession`.

function ownedSession(hostId: string, sessionId: string) {
  return db
    .select({
      id: sessions.id,
      experienceName: experiences.name,
      startsAt: sessions.startsAt,
      timeZone: sessions.timeZone,
      allocation: sessions.allocation,
      seatsSold: sessions.seatsSold,
      status: sessions.status,
    })
    .from(sessions)
    .innerJoin(experiences, eq(experiences.id, sessions.experienceId))
    .where(and(eq(sessions.id, sessionId), eq(experiences.hostId, hostId)));
}

/** The impact moves when a first submit of the same form lands in between, and the session is then cancelled: that repeat is not a changed impact. */
async function isCancelled(hostId: string, sessionId: string) {
  const [session] = await ownedSession(hostId, sessionId);
  return session?.status === 'cancelled';
}

/** One session of the host with what cancelling it would do to its guests, or null when it is missing or another host's. Refused to everyone but the host's owner. */
export async function readHostSessionCancel(
  caller: Caller,
  hostId: string,
  sessionId: string,
): Promise<HostCancelData | null> {
  const host = WriteIdSchema.parse(hostId);
  const id = WriteIdSchema.parse(sessionId);
  requireRole(caller, Role.HostOwner, { hostId: host });
  const at = await currentDatabaseTime();
  const [session] = await ownedSession(host, id);
  if (!session) return null;
  return { session, impact: await readImpact(db, [session.id], at), at };
}

/**
 * Cancels a session of the host as the host's own cancellation, when the impact the owner read is
 * still the impact now. Refused before anything is written when the session has started, when a
 * booking cannot be refunded in full, or when the impact changed since it was read. A session that
 * is already cancelled is not a changed impact, so a repeat of a submit that went through, one after
 * the other or at the same moment, answers `already_cancelled` and finishes what a failed run left;
 * `cancelSession` writes nothing twice and refunds each booking once. Runs in a Server Action only.
 */
export async function cancelSessionAsHost(
  caller: Caller,
  hostId: string,
  input: ImpactFormInput,
): Promise<OpsCancelOutcome> {
  const host = WriteIdSchema.parse(hostId);
  const sessionId = WriteIdSchema.parse(input.sessionId);
  requireRole(caller, Role.HostOwner, { hostId: host });
  const at = await currentDatabaseTime();
  const [session] = await ownedSession(host, sessionId);
  if (!session) return { kind: 'done', result: { status: 'not_found' } };
  if (cancelGate(session, at) === 'ended') return { kind: 'ended' };
  const impact = await readImpact(db, [sessionId], at);
  if (cancelBlocked(impact)) return { kind: 'blocked' };
  if (
    !impactIsCurrent(input.fingerprint, impact) &&
    !(await isCancelled(host, sessionId))
  ) {
    return { kind: 'stale' };
  }
  return {
    kind: 'done',
    result: await cancelSession(caller, { sessionId, reason: 'host' }),
  };
}
