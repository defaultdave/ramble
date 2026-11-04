import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  bookingPaid,
  cardFee,
  giftPurchased,
  rambleSelfPayout,
  refundRequested,
  refundSucceeded,
  transferPaid,
} from '@/lib/ledger';
import { ForbiddenError, Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import {
  client,
  common,
  ledger,
  newBooking,
  nextProviderId,
  openLedgerDatabase,
  parents,
  post,
  worked,
} from './ledgerFixtures';
import { createLedgerParents } from './ledgerParents';

// Behaviours under test, one per decision, branch or risk.
// Reads:
// - cash balance, money held, finance export, and the host statement match what was posted
// - the window is half open on occurred_at; a host statement shows only that host
// - the host statement is for host owners of that host; a missing host, another host, ops, admin, a guest, and nobody get the same refusal
// - the export, money held, and cash balance are for ops and admin; host owners and guests are refused
// - an invalid window is refused

openLedgerDatabase();

describe('the views', () => {
  const from = new Date('2026-12-01T00:00:00Z');
  const to = new Date('2026-12-08T00:00:00Z');
  const inside = new Date('2026-12-03T15:00:00Z');
  const outside = new Date('2026-12-08T00:00:00Z');
  const ops = testCaller({ roles: [Role.Ops] });
  const admin = testCaller({ roles: [Role.Admin] });

  // Another host's booking, to prove a statement shows only its own host.
  let otherHostId: string;
  let booking: Awaited<ReturnType<typeof newBooking>>;
  let baseline: { cash: number; held: number };

  beforeAll(async () => {
    const other = await createLedgerParents(client.db, 'ledger-other');
    otherHostId = other.hostId;
    booking = await newBooking();
    baseline = {
      cash: await ledger.readCashBalance(ops),
      held: (await ledger.readMoneyHeld(ops)).moneyHeldMinor,
    };
    const when = { occurredAt: inside, simulated: true };
    await post(
      bookingPaid({
        ...when,
        ...booking,
        providerObjectId: nextProviderId(),
        split: worked,
      }),
    );
    await post(
      cardFee({
        ...when,
        ...booking,
        providerObjectId: nextProviderId(),
        amountMinor: 407,
      }),
    );
    const transferId = await parents.newTransfer(booking.orderId);
    await post(
      transferPaid({
        ...when,
        orderId: booking.orderId,
        hostId: booking.hostId,
        transferId,
        providerObjectId: nextProviderId(),
        amountMinor: 1000,
      }),
    );
    const refund = await parents.newRefund(
      booking.orderId,
      booking.paymentAttemptId,
    );
    const refundLinks = {
      ...when,
      orderId: booking.orderId,
      hostId: booking.hostId,
      refundId: refund,
    };
    await post(
      refundRequested({
        ...refundLinks,
        split: { ticketMinor: 6500, commissionMinor: 975, taxMinor: 0 },
      }),
    );
    // A booking on another host, inside the window, and a row of this booking outside it.
    const stranger = await parents.newOrder();
    const strangerAttempt = await parents.newAttempt(stranger);
    await post(
      bookingPaid({
        ...when,
        orderId: stranger,
        hostId: otherHostId,
        paymentAttemptId: strangerAttempt,
        providerObjectId: nextProviderId(),
        split: worked,
      }),
    );
    await post(
      cardFee({
        occurredAt: outside,
        simulated: false,
        ...booking,
        providerObjectId: nextProviderId(),
        amountMinor: 999,
      }),
    );
    await post(
      rambleSelfPayout({
        ...when,
        providerObjectId: nextProviderId(),
        amountMinor: 700,
      }),
    );
    await post(
      giftPurchased({
        ...when,
        giftId: randomUUID(),
        providerObjectId: nextProviderId(),
        amountMinor: 5000,
      }),
    );
  });

  it('give the cash balance and the money held from every posting', async () => {
    // booking: +13000 -407 -1000 (transfer); stranger: +13000; fee outside: -999; payout: -700; gift: +5000
    expect((await ledger.readCashBalance(ops)) - baseline.cash).toBe(
      13000 - 407 - 1000 + 13000 - 999 - 700 + 5000,
    );
    const held = await ledger.readMoneyHeld(ops);
    // host_payable: 11050 - 1000 - 5525 + 11050 (stranger); refunds_pending 6500; gift_liability 5000
    expect(held.moneyHeldMinor - baseline.held).toBe(
      11050 - 1000 - 5525 + 11050 + 6500 + 5000,
    );
    expect(held.moneyHeldMinor).toBe(
      held.balances.host_payable +
        held.balances.gift_liability +
        held.balances.refunds_pending,
    );
  });

  it('exports one row per booking in the half-open window, marking simulated money', async () => {
    const rows = await ledger.readFinanceExport(ops, { from, to });
    const mine = rows.find((row) => row.orderId === booking.orderId);
    expect(rows.filter((row) => row.orderId === booking.orderId)).toHaveLength(
      1,
    );
    expect(mine).toEqual({
      orderId: booking.orderId,
      hostId: booking.hostId,
      grossMinor: 13000,
      taxMinor: 0,
      commissionMinor: 1950,
      processingFeeMinor: 407,
      refundedMinor: 6500,
      paidToHostMinor: 1000,
      owedToHostMinor: 11050 - 1000 - 5525,
      simulated: true,
      firstAt: inside,
      paidAt: inside,
    });
    expect(rows.some((row) => row.hostId === otherHostId)).toBe(true);
  });

  it('leaves out rows at the end of the window and takes rows at its start', async () => {
    const atEnd = await ledger.readFinanceExport(ops, {
      from: inside,
      to: outside,
    });
    expect(
      atEnd.find((row) => row.orderId === booking.orderId)?.processingFeeMinor,
    ).toBe(407);
    const exactlyAtStart = await ledger.readFinanceExport(ops, {
      from: outside,
      to: new Date('2026-12-09T00:00:00Z'),
    });
    expect(
      exactlyAtStart.find((row) => row.orderId === booking.orderId),
    ).toMatchObject({ processingFeeMinor: 999, simulated: false });
  });

  it("shows a host its own bookings and totals, and not another host's", async () => {
    const owner = testCaller({
      roles: [Role.HostOwner],
      hostIds: [booking.hostId],
    });
    const statement = await ledger.readHostStatement(owner, booking.hostId, {
      from,
      to,
    });
    expect(statement.rows.map((row) => row.orderId)).toEqual([booking.orderId]);
    expect(statement.totals).toMatchObject({
      grossMinor: 13000,
      commissionMinor: 1950,
      paidToHostMinor: 1000,
    });
  });

  it('refuses a host statement with the same error for a missing host, another host, ops, admin, a guest, and nobody', async () => {
    const owner = testCaller({
      roles: [Role.HostOwner],
      hostIds: [booking.hostId],
    });
    const attempts = [
      ledger.readHostStatement(owner, randomUUID(), { from, to }),
      ledger.readHostStatement(owner, otherHostId, { from, to }),
      ledger.readHostStatement(ops, booking.hostId, { from, to }),
      ledger.readHostStatement(admin, booking.hostId, { from, to }),
      ledger.readHostStatement(testCaller(), booking.hostId, { from, to }),
      ledger.readHostStatement(
        { userId: null, roles: [], hostIds: [] },
        booking.hostId,
        { from, to },
      ),
    ];
    const results = await Promise.allSettled(attempts);
    const reasons = results.map((result) =>
      result.status === 'rejected' ? (result.reason as Error) : null,
    );
    for (const reason of reasons) {
      expect(reason).toBeInstanceOf(ForbiddenError);
    }
    expect(
      new Set(
        reasons.map((reason) => [reason?.name, reason?.message].join('|')),
      ).size,
    ).toBe(1);
  });

  it.each([
    [
      'a host owner',
      testCaller({ roles: [Role.HostOwner], hostIds: [randomUUID()] }),
    ],
    ['a guest', testCaller()],
    ['nobody', { userId: null, roles: [], hostIds: [] }],
  ])(
    'refuses the export, money held, and cash balance to %s',
    async (_name, caller) => {
      await expect(
        ledger.readFinanceExport(caller, { from, to }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ledger.readMoneyHeld(caller)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(ledger.readCashBalance(caller)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    },
  );

  it('lets admin read the staff views', async () => {
    await expect(
      ledger.readFinanceExport(admin, { from, to }),
    ).resolves.toBeDefined();
    await expect(ledger.readMoneyHeld(admin)).resolves.toBeDefined();
    await expect(ledger.readCashBalance(admin)).resolves.toBeTypeOf('number');
  });

  it('refuses a window that does not start before it ends, after checking who is asking', async () => {
    await expect(
      ledger.readFinanceExport(ops, { from: to, to: from }),
    ).rejects.toThrow();
    const owner = testCaller({
      roles: [Role.HostOwner],
      hostIds: [booking.hostId],
    });
    await expect(
      ledger.readHostStatement(owner, booking.hostId, { from: to, to: from }),
    ).rejects.toThrow();
  });

  it('keeps the money-held figure tied to a refund that then succeeded', async () => {
    const before = (await ledger.readMoneyHeld(ops)).balances.refunds_pending;
    const refund = await parents.newRefund(
      booking.orderId,
      booking.paymentAttemptId,
    );
    const links = {
      ...common,
      orderId: booking.orderId,
      hostId: booking.hostId,
      refundId: refund,
    };
    await post(
      refundRequested({
        ...links,
        split: { ticketMinor: 100, commissionMinor: 0, taxMinor: 0 },
      }),
    );
    expect((await ledger.readMoneyHeld(ops)).balances.refunds_pending).toBe(
      before + 100,
    );
    await post(
      refundSucceeded({
        ...links,
        providerObjectId: nextProviderId(),
        amountMinor: 100,
      }),
    );
    expect((await ledger.readMoneyHeld(ops)).balances.refunds_pending).toBe(
      before,
    );
  });
});
