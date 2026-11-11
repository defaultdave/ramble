import { describe, expect, it } from 'vitest';
import { jobLimits } from '@/lib/jobs';
import { jobRegistry } from './registry';

// Behaviours under test, one per decision, branch, or risk:
// - the three cancellation jobs are registered, each with the default number of attempts
// - each registered payload is the strict schema of its job: a payload with an extra key or a bad id never enqueues

const orderId = '0f6c9a52-3b8e-4f43-9a55-1a2b3c4d5e01';

describe('the cancellation jobs in the registry', () => {
  it.each([
    ['guest-cancellation', { orderId, cancelledBy: 'guest', refundMinor: 5 }],
    ['host-cancellation-notice', { orderId, cancelledBy: 'guest' }],
    ['guest-refund', { refundId: orderId }],
  ] as const)(
    '%s retries the default number of times and takes its payload',
    (kind, good) => {
      const job = jobRegistry[kind];

      expect(job.maxAttempts).toBe(jobLimits.defaultMaxAttempts);
      expect(job.payload.safeParse(good).success).toBe(true);
      expect(job.payload.safeParse({ ...good, extra: 1 }).success).toBe(false);
    },
  );
});

describe('the payloads refuse what is not theirs', () => {
  it.each([
    ['guest-cancellation', { orderId, cancelledBy: 'someone', refundMinor: 5 }],
    ['guest-cancellation', { orderId, cancelledBy: 'guest', refundMinor: -1 }],
    ['host-cancellation-notice', { orderId, cancelledBy: 'someone' }],
    ['host-cancellation-notice', { orderId: 'nope', cancelledBy: 'guest' }],
    ['guest-refund', { refundId: 'nope' }],
    ['guest-refund', { refundId: 7 }],
  ] as const)('%s refuses %o', (kind, bad) => {
    expect(jobRegistry[kind].payload.safeParse(bad).success).toBe(false);
  });
});
