import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import {
  opsFullRefundRequest,
  refundAuditEntry,
  pickRetry,
} from './refundRetry';

// Behaviours under test:
// - the whole-rest ops refund is one key for the order, naming the ops user
// - a retry asks for the failed refund's own ticket part, never the rest of the order, under a key named for that refund
// - it keeps the failed refund's reason when the refund path takes it, and uses the ops reason otherwise
// - it stops for no order, an order not flagged, a gift purchase, and no failed refund to retry
// - a failed refund with no ticket part, or whose retry already exists, is passed over and an older one is retried instead; when none is left it stops
// - the audit row is valid and names the new refund by id, for a request and for a retry

const orderId = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const userId = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const flagged = { kind: 'booking', refundFailed: true } as const;
const failed = { id: 'f1', reason: 'guest_cancel', ticketMinor: 8500 };

describe('opsFullRefundRequest', () => {
  it('asks for the whole rest under the one ops key, naming the ops user', () => {
    expect(opsFullRefundRequest(orderId, userId)).toEqual({
      orderId,
      reason: 'ops_adjustment',
      key: 'ops-refund',
      ticketMinor: 'remaining',
      initiatedBy: userId,
    });
  });
});

const idOf = (request: { key: string }) => `id-of-${request.key}`;
const pick = (over: Partial<Parameters<typeof pickRetry>[0]> = {}) =>
  pickRetry({
    orderId,
    userId,
    order: flagged,
    failed: [failed],
    standingIds: new Set(),
    refundIdOf: idOf,
    ...over,
  });

describe('pickRetry', () => {
  it("retries that refund's own ticket part under a name made from it, keeping a known reason", () => {
    expect(pick()).toEqual({
      kind: 'retry',
      request: {
        orderId,
        reason: 'guest_cancel',
        key: 'retry:f1',
        ticketMinor: 8500,
        initiatedBy: userId,
      },
    });
  });

  it('uses the ops reason for a reason the refund path does not take', () => {
    const plan = pick({ failed: [{ ...failed, reason: 'gift_unredeemed' }] });
    expect(plan.kind === 'retry' && plan.request.reason).toBe('ops_adjustment');
  });

  it.each([
    ['no order', { order: null }],
    [
      'an order not flagged',
      { order: { kind: 'booking', refundFailed: false } },
    ],
    [
      'a gift purchase',
      { order: { kind: 'gift_purchase', refundFailed: true } },
    ],
    ['no failed refund', { failed: [] }],
  ] as const)('stops for %s', (_name, over) => {
    expect(pick(over)).toEqual({ kind: 'stop' });
  });

  it('passes over a newest failed refund with no ticket part, so it cannot block an older valid one', () => {
    const plan = pick({
      failed: [
        { id: 'newest', reason: 'goodwill', ticketMinor: 0 },
        { id: 'older', reason: 'goodwill', ticketMinor: 2000 },
      ],
    });
    expect(plan.kind === 'retry' && plan.request.key).toBe('retry:older');
  });

  it('passes over a failed refund whose retry already exists, so an older one is not stuck', () => {
    const plan = pick({
      failed: [
        { id: 'newer', reason: 'goodwill', ticketMinor: 4000 },
        { id: 'older', reason: 'goodwill', ticketMinor: 3000 },
      ],
      standingIds: new Set(['id-of-retry:newer']),
    });
    expect(plan.kind === 'retry' && plan.request).toMatchObject({
      key: 'retry:older',
      ticketMinor: 3000,
    });
  });

  it('stops when every failed refund is passed over', () => {
    expect(
      pick({
        failed: [{ id: 'a', reason: 'goodwill', ticketMinor: 0 }, failed],
        standingIds: new Set(['id-of-retry:f1']),
      }),
    ).toEqual({ kind: 'stop' });
  });
});

describe('refundAuditEntry', () => {
  it.each([
    'booking.ops_refund_requested',
    'booking.ops_refund_retried',
  ] as const)(
    'is a valid row for %s naming the user, the order, and the refund',
    (action) => {
      const entry = refundAuditEntry(action, userId, orderId, orderId);
      expect(() => parseAuditEntry(entry)).not.toThrow();
      expect(entry).toMatchObject({
        actorId: userId,
        action,
        subjectId: orderId,
        details: { refund_id: orderId },
      });
    },
  );
});
