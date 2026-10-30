import { randomInt, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { orderItems, orders, sessions } from '@/server/db/schema';
import { setEnv } from '../email/testEnv';
import { createFreshDatabase, type FreshDatabase } from './harness';
import { insertHold } from './holdFixtures';
import { createOrderParents } from './orderParents';

const testEnv = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock('@/server/env', () => ({ env: testEnv }));

// Behaviours under test, one per decision, branch, or risk. Orders are confirmed bookings on one session unless named.
// access
// - an order's token opens that order and not another; each order's token opens its own
// - a token with one character changed, an empty token, a token of the wrong shape, a token with a character added,
//   a token from another version, a manage token, an unknown reference, and a malformed reference are refused with the same null
// - after a bump the old token is refused and the rebuilt token opens the order
// the page
// - a confirmed order is a receipt from the snapshot, with a manage link that opens that order and no other
// - a pending order is pending, and a cancelled order a notice, each with no manage link
// the status
// - the status answers with the order's own state for its own token and null for another's
// - the action answers `unknown` for a bad input, another order's token, and an unknown reference alike

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let tokens: typeof import('@/server/tokens');
let confirmation: typeof import('@/server/orderConfirmation');
let action: typeof import('@/server/actions/orders');
let parents: Awaited<ReturnType<typeof createOrderParents>>;
let sessionId: string;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  setEnv(testEnv, {
    DATABASE_URL: fresh.url,
    APP_URL: 'https://ramble.example',
  });
  client = await import('@/server/db/client');
  tokens = await import('@/server/tokens');
  confirmation = await import('@/server/orderConfirmation');
  action = await import('@/server/actions/orders');
  parents = await createOrderParents(client.db, 'order-confirmation');
  const [session] = await client.db
    .insert(sessions)
    .values({
      experienceId: parents.experienceId,
      startsAt: new Date('2026-11-07T21:00:00Z'),
      endsAt: new Date('2026-11-07T23:00:00Z'),
      timeZone: 'America/New_York',
      allocation: 20,
      source: 'ramble',
    })
    .returning();
  if (!session) throw new Error('missing fixtures');
  sessionId = session.id;
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function reference() {
  return `RMB-${Array.from({ length: 6 }, () => crockford[randomInt(crockford.length)]).join('')}`;
}

async function insertOrder(
  status: 'confirmed' | 'pending_payment' | 'cancelled' = 'confirmed',
) {
  const id = randomUUID();
  const { id: holdId } = await insertHold(client.db, sessionId);
  const confirmed = status !== 'pending_payment';
  const [row] = await client.db
    .insert(orders)
    .values({
      id,
      reference: reference(),
      kind: 'booking',
      status,
      idempotencyKey: `book:${holdId}`,
      holdId,
      sessionId,
      experienceId: parents.experienceId,
      hostId: parents.hostId,
      guestId: parents.guestId,
      contactEmail: 'pat@example.com',
      leadGuestName: 'Pat Rivera',
      termsDocumentId: parents.termsDocumentId,
      ticketSubtotalMinor: 17000,
      taxTreatment: 'not_taxable',
      taxRatePpm: 0,
      taxMinor: 0,
      totalMinor: 17000,
      amountDueMinor: 17000,
      commissionRateBps: 1500,
      commissionMinor: 2550,
      cancellationTierId: parents.tierId,
      freeCancelUntil: new Date('2026-11-06T21:00:00Z'),
      manageTokenHash: confirmed
        ? tokens.hashToken(tokens.capabilityToken('manage', id, 1))
        : null,
      confirmedAt: confirmed ? sql`clock_timestamp()` : null,
      cancelledAt: status === 'cancelled' ? sql`clock_timestamp()` : null,
      cancelledBy: status === 'cancelled' ? 'guest' : null,
    })
    .returning();
  if (!row) throw new Error('insert returned no order');
  await client.db.insert(orderItems).values({
    orderId: id,
    priceOptionId: parents.priceOptionId,
    label: 'Adult',
    quantity: 2,
    unitPriceMinor: 8500,
    usesSpace: true,
    lineTotalMinor: 17000,
  });
  return row;
}

const orderToken = (id: string, version = 1) =>
  tokens.capabilityToken('order', id, version);

function tampered(token: string): string {
  const flipped = token.startsWith('A') ? 'B' : 'A';
  return `${flipped}${token.slice(1)}`;
}

describe('the order token', () => {
  it("opens its own order and not another's", async () => {
    const a = await insertOrder();
    const b = await insertOrder();
    const open = (order: typeof a, token: string) =>
      confirmation.readOrderPage(order.reference, token);

    expect((await open(a, orderToken(a.id)))?.kind).toBe('confirmed');
    expect((await open(b, orderToken(b.id)))?.kind).toBe('confirmed');
    expect(await open(a, orderToken(b.id))).toBeNull();
    expect(await open(b, orderToken(a.id))).toBeNull();
  });

  it('is refused the same way for every wrong token, reference, and version', async () => {
    const a = await insertOrder();
    const good = orderToken(a.id);
    const refusals = await Promise.all([
      confirmation.readOrderPage(a.reference, tampered(good)),
      confirmation.readOrderPage(a.reference, ''),
      confirmation.readOrderPage(a.reference, 'short'),
      confirmation.readOrderPage(a.reference, `${good}x`),
      confirmation.readOrderPage(a.reference, orderToken(a.id, 2)),
      confirmation.readOrderPage('RMB-ZZZZZZ', good),
      confirmation.readOrderPage('not-a-reference', good),
      confirmation.readOrderPage(
        a.reference,
        tokens.capabilityToken('manage', a.id, 1),
      ),
    ]);
    expect(refusals).toEqual(refusals.map(() => null));
  });

  it('stops working after a version bump, and the rebuilt token works', async () => {
    const a = await insertOrder();
    const before = orderToken(a.id);
    await client.db.transaction((tx) =>
      tokens.bumpTokenVersion(tx, 'order', a.id),
    );
    expect(await confirmation.readOrderPage(a.reference, before)).toBeNull();
    expect(
      (await confirmation.readOrderPage(a.reference, orderToken(a.id, 2)))
        ?.kind,
    ).toBe('confirmed');
  });
});

describe('the page', () => {
  it('is a receipt from the snapshot, with a manage link that opens that order only', async () => {
    const a = await insertOrder();
    const b = await insertOrder();
    const page = await confirmation.readOrderPage(
      a.reference,
      orderToken(a.id),
    );
    if (page?.kind !== 'confirmed') throw new Error('expected a receipt');
    expect(page.receipt).toMatchObject({
      reference: a.reference,
      partyLabel: '2 guests',
      total: '$170.00',
      dayLabel: 'Saturday, November 7, 2026',
    });
    const manageToken = page.receipt.manageHref.replace('/manage/', '');
    expect((await tokens.resolveToken('manage', manageToken))?.id).toBe(a.id);
    expect(manageToken).not.toBe(tokens.capabilityToken('manage', b.id, 1));
  });

  it('is pending for an unpaid order, with no manage link', async () => {
    const order = await insertOrder('pending_payment');
    const page = await confirmation.readOrderPage(
      order.reference,
      orderToken(order.id),
    );
    expect(page?.kind).toBe('pending');
    expect(JSON.stringify(page)).not.toContain('/manage/');
  });

  it('is a notice for a cancelled order, with no manage link', async () => {
    const order = await insertOrder('cancelled');
    const page = await confirmation.readOrderPage(
      order.reference,
      orderToken(order.id),
    );
    expect(page?.kind).toBe('notice');
    expect(JSON.stringify(page)).not.toContain('/manage/');
  });
});

describe('the status', () => {
  it("answers with the order's own state for its own token only", async () => {
    const paid = await insertOrder();
    const waiting = await insertOrder('pending_payment');
    expect(
      await confirmation.readOrderState(paid.reference, orderToken(paid.id)),
    ).toBe('confirmed');
    expect(
      await confirmation.readOrderState(
        waiting.reference,
        orderToken(waiting.id),
      ),
    ).toBe('pending');
    expect(
      await confirmation.readOrderState(waiting.reference, orderToken(paid.id)),
    ).toBeNull();
  });

  it('is `unknown` from the action for a bad input, another order, and no order alike', async () => {
    const a = await insertOrder();
    const b = await insertOrder();
    const answers = await Promise.all([
      action.getOrderStatus({ reference: a.reference, token: 'short' }),
      action.getOrderStatus({
        reference: a.reference,
        token: orderToken(b.id),
      }),
      action.getOrderStatus({
        reference: 'RMB-ZZZZZZ',
        token: orderToken(a.id),
      }),
    ]);
    expect(answers).toEqual(answers.map(() => ({ state: 'unknown' })));
    expect(
      await action.getOrderStatus({
        reference: a.reference,
        token: orderToken(a.id),
      }),
    ).toEqual({ state: 'confirmed' });
  });
});
