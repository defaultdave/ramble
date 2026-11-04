import type { OrderStatus } from './orders';
import type {
  AttemptMatch,
  EventAttempt,
  EventFacts,
  EventHold,
  EventOrder,
  PaymentEventType,
} from './providerEvents';

export const now = new Date('2026-10-29T12:00:00.000Z');
export const later = new Date('2026-10-29T12:05:00.000Z');
export const earlier = new Date('2026-10-29T11:55:00.000Z');
export const orderId = '00000000-0000-4000-8000-0000000000a1';
export const recordId = '00000000-0000-4000-8000-0000000000b2';

export function attempt(over: Partial<EventAttempt> = {}): EventAttempt {
  return {
    id: recordId,
    status: 'created',
    failedTries: 0,
    providerPaymentId: 'pay_1',
    method: null,
    ...over,
  };
}

export function facts(
  type: PaymentEventType,
  over: Partial<EventFacts> = {},
): EventFacts {
  return {
    type,
    objectId: 'pay_1',
    rambleRecordId: recordId,
    method: 'card',
    failureCode: 'card_declined',
    ...over,
  };
}

export const holdId = '00000000-0000-4000-8000-0000000000d4';

export function hold(
  status: EventHold['status'],
  expiresAt: Date,
  payingUntil: Date | null = null,
): EventHold {
  return { id: holdId, status, expiresAt, payingUntil };
}

export function order(
  status: OrderStatus,
  heldBy: EventHold | null = hold('paying', later),
): EventOrder {
  return { id: orderId, status, hold: heldBy };
}

export const same = (a: EventAttempt): AttemptMatch => ({
  kind: 'payment',
  attempt: a,
});
