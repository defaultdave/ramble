import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  readDatabaseTime: vi.fn(),
  readReviewOrder: vi.fn(),
  insertReview: vi.fn(),
  consumeRateLimit: vi.fn(),
  resolveToken: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', () => ({
  db: { transaction: mocks.transaction },
}));
vi.mock('@/server/db/reviews', () => ({
  readReviewOrder: mocks.readReviewOrder,
  insertReview: mocks.insertReview,
}));
vi.mock('@/server/db/time', () => ({
  readDatabaseTime: mocks.readDatabaseTime,
}));
vi.mock('@/server/ports/rate-limit', () => ({
  consumeRateLimit: mocks.consumeRateLimit,
}));
vi.mock('@/server/tokens', () => ({ resolveToken: mocks.resolveToken }));

import { readReviewPage, submitReview } from './reviewForm';

// Behaviours under test:
// - a link of the wrong shape is invalid before anything is counted, looked up, or read from the database, for the page and for the submit
// - a link counted out is told to wait, for the page and for the submit, with no read of the order
// - a link that opens nothing is invalid
// - a link that opens an order is read with the database's time in one transaction, and the page carries the order's facts and its summary

const reference = 'RMB-7K3M9Q';
const token = 'A'.repeat(43);
const now = new Date('2026-11-17T12:00:00Z');
const tx = { tx: true };

function expectNoDatabase() {
  expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  expect(mocks.resolveToken).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.readDatabaseTime).not.toHaveBeenCalled();
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true });
  mocks.transaction.mockImplementation((work: (t: unknown) => unknown) =>
    work(tx),
  );
  mocks.readDatabaseTime.mockResolvedValue(now);
});

describe('readReviewPage', () => {
  it.each([
    ['a token of the wrong shape', reference, 'sample'],
    ['a reference of the wrong shape', 'nope', token],
  ])('is invalid for %s, before the database', async (_label, ref, tok) => {
    expect(await readReviewPage(ref, tok)).toEqual({
      read: { kind: 'invalid' },
      summary: null,
    });
    expectNoDatabase();
  });

  it('tells a link counted out to wait, and reads no order', async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 30,
    });
    expect(await readReviewPage(reference, token)).toEqual({
      read: { kind: 'rate_limited', retryAfterSeconds: 30 },
      summary: null,
    });
    expect(mocks.resolveToken).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('is invalid for a link that opens nothing', async () => {
    mocks.resolveToken.mockResolvedValue(null);
    expect(await readReviewPage(reference, token)).toEqual({
      read: { kind: 'invalid' },
      summary: null,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('reads the order and the database time in one transaction for a link that opens one', async () => {
    mocks.resolveToken.mockResolvedValue({ id: 'order-1' });
    const facts = {
      kind: 'booking',
      status: 'confirmed',
      refundedTicketMinor: 0,
      refundedTaxMinor: 0,
      endsAt: new Date('2026-11-17T08:00:00Z'),
      reviewed: false,
    };
    mocks.readReviewOrder.mockResolvedValue({
      facts,
      experienceName: 'Sunset kayak',
      hostName: 'Tide Club',
      startsAt: new Date('2026-11-17T06:00:00Z'),
      timeZone: 'America/New_York',
    });
    const page = await readReviewPage(reference, token);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.readReviewOrder).toHaveBeenCalledWith(tx, 'order-1');
    expect(mocks.readDatabaseTime).toHaveBeenCalledWith(tx);
    expect(page.read).toEqual({ kind: 'found', facts, now });
    expect(page.summary).toMatchObject({
      experienceName: 'Sunset kayak',
      hostName: 'Tide Club',
    });
  });

  it('is invalid when the order is gone by the time it is read', async () => {
    mocks.resolveToken.mockResolvedValue({ id: 'order-1' });
    mocks.readReviewOrder.mockResolvedValue(null);
    expect(await readReviewPage(reference, token)).toEqual({
      read: { kind: 'invalid' },
      summary: null,
    });
  });
});

describe('submitReview', () => {
  const input = { reference, token, rating: 4, body: 'Lovely' };

  it('is not found for a link of the wrong shape, before the database', async () => {
    expect(await submitReview({ ...input, token: 'sample' })).toBe('not_found');
    expectNoDatabase();
  });

  it('is rate limited for a link counted out', async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 30,
    });
    expect(await submitReview(input)).toBe('rate_limited');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('writes the review for the order the link opens and answers what the write answers', async () => {
    mocks.resolveToken.mockResolvedValue({ id: 'order-1' });
    mocks.insertReview.mockResolvedValue('created');
    expect(await submitReview(input)).toBe('created');
    expect(mocks.insertReview).toHaveBeenCalledExactlyOnceWith(tx, {
      orderId: 'order-1',
      rating: 4,
      body: 'Lovely',
    });
  });
});
