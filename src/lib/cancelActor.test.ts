import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import {
  cancellationAuditEntry,
  cancelledByFor,
  guestCancelActor,
  opsCancelRequestedEntry,
} from './cancelBooking';

// Behaviours under test:
// - the guest is the default actor and the order records the guest; an ops cancel is recorded as Ramble's
// - the cancellation's audit row names a guest by kind alone and an ops user by id, with the same details
// - the ops audit row names the ops user and the order, with no details
// - every row is one the audit log accepts

const ids = {
  orderId: '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  sessionId: '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  refundMinor: 13000,
  refundId: null,
  seatsReturned: 2,
  giftReinstated: false,
};
const userId = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';

describe('who cancels', () => {
  it.each([
    [guestCancelActor, 'guest'],
    [{ kind: 'ops', userId }, 'ramble'],
  ] as const)('records %j as %s', (actor, cancelledBy) => {
    expect(cancelledByFor(actor)).toBe(cancelledBy);
  });

  it('audits a guest cancel by default, with no actor id', () => {
    const entry = cancellationAuditEntry(ids);
    expect(entry).toMatchObject({
      actorKind: 'guest',
      action: 'order.cancelled',
      details: { cancelled_by: 'guest' },
    });
    expect(entry).not.toHaveProperty('actorId');
  });

  it('audits an ops cancel naming the ops user and Ramble as the canceller', () => {
    expect(cancellationAuditEntry(ids, { kind: 'ops', userId })).toMatchObject({
      actorKind: 'user',
      actorId: userId,
      action: 'order.cancelled',
      details: { cancelled_by: 'ramble', refund_minor: 13000 },
    });
  });

  it('writes the ops row for the order, naming the ops user', () => {
    expect(opsCancelRequestedEntry(userId, ids.orderId)).toEqual({
      actorKind: 'user',
      actorId: userId,
      action: 'booking.ops_cancel_requested',
      subjectKind: 'order',
      subjectId: ids.orderId,
      details: {},
    });
  });

  it.each([
    ['a guest cancel', cancellationAuditEntry(ids)],
    ['an ops cancel', cancellationAuditEntry(ids, { kind: 'ops', userId })],
    ['the ops row', opsCancelRequestedEntry(userId, ids.orderId)],
  ])('writes %s as a row the audit log accepts', (_name, entry) => {
    expect(() => parseAuditEntry(entry)).not.toThrow();
  });
});
