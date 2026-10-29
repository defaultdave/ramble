import { describe, expect, it } from 'vitest';
import {
  LedgerEntrySchema,
  accountBalances,
  bookingPaid,
  cardFee,
  disputeLost,
  disputeOpened,
  disputeWon,
  giftPurchased,
  giftRedeemed,
  giftRefundedOrExpired,
  giftReinstated,
  ledgerAccounts,
  moneyHeld,
  rambleSelfPayout,
  refundFailed,
  refundRequested,
  refundSucceeded,
  transferPaid,
  transferReversed,
  type LedgerAccount,
  type LedgerEntryInput,
  type PostingSplit,
} from './ledger';
import { commissionMinor, taxMinor } from './pricing';
import { fakeCardFeeMinor } from './fakeCardFee';

// Behaviours under test: random but seeded sequences of money events, each built only from states
// the money paths can reach (a refund after a paid transfer first takes the host share back; a gift
// is redeemed, reinstated, or refunded from the state it is in). After every event:
// - the accounting equation holds: cash, expenses and held dispute money equal what is owed to hosts, Ramble, gift holders and refunds
// - refunds_pending, gift_liability and dispute_hold never go below zero, nor does host_payable
// - money held equals host_payable + gift_liability + refunds_pending
// - every row the builders emit parses
// When every pending thing is resolved at the end: refunds_pending and dispute_hold are zero.

const seeds = Array.from({ length: 150 }, (_, index) => index + 1);
const eventsPerRun = 40;

/** mulberry32: a small seeded generator, so a failing run can be replayed from its seed. */
function random(seed: number) {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) =>
      min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T =>
      items[Math.floor(next() * items.length)] as T,
  };
}

const id = (kind: number, n: number) =>
  `00000000-0000-4000-8000-${String(kind * 1_000_000 + n).padStart(12, '0')}`;

type Booking = {
  orderId: string;
  paid: PostingSplit;
  refundedTicket: number;
  refundedCommission: number;
  refundedTax: number;
  pending: { split: PostingSplit; id: string; transferred: boolean }[];
  transferred: number;
  disputed: boolean;
};

type Gift = {
  id: string;
  value: number;
  state: 'held' | 'redeemed' | 'refunded';
  split: PostingSplit;
  orderId: string;
};

function runSequence(seed: number) {
  const rng = random(seed);
  const hostId = id(1, 1);
  const rows: LedgerEntryInput[] = [];
  const bookings: Booking[] = [];
  const gifts: Gift[] = [];
  let counter = 0;
  let clock = Date.UTC(2026, 10, 1);
  const base = () => ({
    occurredAt: new Date((clock += 60_000)),
    simulated: rng.next() < 0.5,
  });
  const nextId = (kind: number) => id(kind, ++counter);
  const provider = (prefix: string) => `${prefix}_${String(++counter)}`;
  const orderBalance = (orderId: string, account: LedgerAccount) =>
    accountBalances(
      rows
        .filter((row) => row.orderId === orderId)
        .map((row) => LedgerEntrySchema.parse(row)),
    )[account];

  const events: (() => void)[] = [];

  const newBooking = () => {
    const ticketMinor = rng.int(100, 2_000_000);
    const split = {
      ticketMinor,
      commissionMinor: commissionMinor(ticketMinor, rng.int(0, 3000)),
      taxMinor: rng.next() < 0.5 ? taxMinor(ticketMinor, 88750) : 0,
    };
    const orderId = nextId(2);
    const common = {
      ...base(),
      orderId,
      hostId,
      paymentAttemptId: nextId(3),
      providerObjectId: provider('pi'),
    };
    rows.push(...bookingPaid({ ...common, split }));
    rows.push(
      ...cardFee({
        ...common,
        amountMinor: fakeCardFeeMinor(split.ticketMinor + split.taxMinor),
      }),
    );
    bookings.push({
      orderId,
      paid: split,
      refundedTicket: 0,
      refundedCommission: 0,
      refundedTax: 0,
      pending: [],
      transferred: 0,
      disputed: false,
    });
  };

  const requestRefund = (booking: Booking) => {
    const ticketLeft = booking.paid.ticketMinor - booking.refundedTicket;
    const taxLeft = booking.paid.taxMinor - booking.refundedTax;
    if (ticketLeft + taxLeft <= 0 || booking.disputed) return;
    const ticketMinor = rng.int(0, ticketLeft);
    const taxPart =
      ticketMinor === ticketLeft
        ? taxLeft
        : rng.int(0, Math.min(taxLeft, 1000));
    if (ticketMinor + taxPart === 0) return;
    const commissionLeft =
      booking.paid.commissionMinor - booking.refundedCommission;
    const split = {
      ticketMinor,
      commissionMinor: rng.int(0, Math.min(ticketMinor, commissionLeft)),
      taxMinor: taxPart,
    };
    const hostPart = split.ticketMinor - split.commissionMinor + split.taxMinor;
    const refundId = nextId(4);
    const common = { ...base(), orderId: booking.orderId, hostId, refundId };
    const needsBack = hostPart - orderBalance(booking.orderId, 'host_payable');
    let transferred = false;
    if (needsBack > 0) {
      // The host share was already sent: the refund first takes it back from the transfer.
      rows.push(
        ...transferReversed({
          ...common,
          transferId: nextId(5),
          providerObjectId: provider('trr'),
          amountMinor: needsBack,
        }),
      );
      booking.transferred -= needsBack;
      transferred = true;
    }
    rows.push(...refundRequested({ ...common, split }));
    booking.refundedTicket += split.ticketMinor;
    booking.refundedCommission += split.commissionMinor;
    booking.refundedTax += split.taxMinor;
    booking.pending.push({ split, id: refundId, transferred });
  };

  const resolveRefund = (booking: Booking) => {
    const pending = booking.pending.shift();
    if (!pending) return;
    const common = {
      ...base(),
      orderId: booking.orderId,
      hostId,
      refundId: pending.id,
    };
    if (rng.next() < 0.6) {
      rows.push(
        ...refundSucceeded({
          ...common,
          providerObjectId: provider('re'),
          amountMinor: pending.split.ticketMinor + pending.split.taxMinor,
        }),
      );
    } else {
      rows.push(...refundFailed({ ...common, split: pending.split }));
      booking.refundedTicket -= pending.split.ticketMinor;
      booking.refundedCommission -= pending.split.commissionMinor;
      booking.refundedTax -= pending.split.taxMinor;
    }
  };

  events.push(newBooking);
  events.push(newBooking);
  events.push(() => {
    if (bookings.length > 0) requestRefund(rng.pick(bookings));
  });
  events.push(() => {
    const open = bookings.filter((booking) => booking.pending.length > 0);
    if (open.length > 0) resolveRefund(rng.pick(open));
  });
  events.push(() => {
    const ready = bookings.filter(
      (booking) =>
        booking.pending.length === 0 &&
        !booking.disputed &&
        orderBalance(booking.orderId, 'host_payable') > 0,
    );
    const booking = ready.length > 0 ? rng.pick(ready) : undefined;
    if (!booking) return;
    const amountMinor = orderBalance(booking.orderId, 'host_payable');
    rows.push(
      ...transferPaid({
        ...base(),
        orderId: booking.orderId,
        hostId,
        transferId: nextId(5),
        providerObjectId: provider('tr'),
        amountMinor,
      }),
    );
    booking.transferred += amountMinor;
  });
  events.push(() => {
    const ticketMinor = rng.int(100, 500_000);
    const split = {
      ticketMinor,
      commissionMinor: commissionMinor(ticketMinor, 1500),
      taxMinor: taxMinor(ticketMinor, 88750),
    };
    const gift: Gift = {
      id: nextId(6),
      value: split.ticketMinor + split.taxMinor,
      state: 'held',
      split,
      orderId: '',
    };
    rows.push(
      ...giftPurchased({
        ...base(),
        giftId: gift.id,
        providerObjectId: provider('pg'),
        amountMinor: gift.value,
      }),
    );
    gifts.push(gift);
  });
  events.push(() => {
    const held = gifts.filter((gift) => gift.state === 'held');
    const gift = held.length > 0 ? rng.pick(held) : undefined;
    if (!gift) return;
    gift.orderId = nextId(2);
    rows.push(
      ...giftRedeemed({
        ...base(),
        giftId: gift.id,
        orderId: gift.orderId,
        hostId,
        split: gift.split,
      }),
    );
    gift.state = 'redeemed';
  });
  events.push(() => {
    const redeemed = gifts.filter((gift) => gift.state === 'redeemed');
    const gift = redeemed.length > 0 ? rng.pick(redeemed) : undefined;
    if (!gift) return;
    rows.push(
      ...giftReinstated({
        ...base(),
        giftId: gift.id,
        orderId: gift.orderId,
        hostId,
        split: gift.split,
      }),
    );
    gift.state = 'held';
  });
  events.push(() => {
    const held = gifts.filter((gift) => gift.state === 'held');
    const gift = held.length > 0 ? rng.pick(held) : undefined;
    if (!gift) return;
    const common = { ...base(), giftId: gift.id };
    rows.push(...giftRefundedOrExpired({ ...common, amountMinor: gift.value }));
    rows.push(
      ...refundSucceeded({
        ...common,
        refundId: nextId(4),
        providerObjectId: provider('re'),
        amountMinor: gift.value,
      }),
    );
    gift.state = 'refunded';
  });
  events.push(() => {
    const target = bookings.find(
      (booking) => !booking.disputed && booking.pending.length === 0,
    );
    if (!target) return;
    const amountMinor = target.paid.ticketMinor + target.paid.taxMinor;
    const links = {
      ...base(),
      orderId: target.orderId,
      hostId,
      disputeId: nextId(7),
    };
    const providerObjectId = provider('dp');
    rows.push(
      ...disputeOpened({
        ...links,
        providerObjectId,
        amountMinor,
        feeMinor: rng.int(0, 1500),
      }),
    );
    target.disputed = true;
    if (rng.next() < 0.5) {
      rows.push(...disputeWon({ ...links, providerObjectId, amountMinor }));
    } else {
      const hostCoveredMinor = Math.min(
        amountMinor,
        Math.max(0, orderBalance(target.orderId, 'host_payable')),
      );
      rows.push(...disputeLost({ ...links, amountMinor, hostCoveredMinor }));
    }
  });
  events.push(() => {
    const commission = accountBalances(
      rows.map((row) => LedgerEntrySchema.parse(row)),
    );
    const available = commission.ramble_commission - commission.ramble_payouts;
    if (available <= 0) return;
    rows.push(
      ...rambleSelfPayout({
        ...base(),
        providerObjectId: provider('po'),
        amountMinor: rng.int(1, available),
      }),
    );
  });

  const check = (step: string) => {
    const parsed = rows.map((row) => LedgerEntrySchema.parse(row));
    const balances = accountBalances(parsed);
    for (const account of [
      'refunds_pending',
      'gift_liability',
      'dispute_hold',
      'host_payable',
    ] as const) {
      expect(
        balances[account],
        `seed ${String(seed)} ${step}: ${account}`,
      ).toBeGreaterThanOrEqual(0);
    }
    expect(moneyHeld(balances)).toBe(
      balances.host_payable +
        balances.gift_liability +
        balances.refunds_pending,
    );
    // The accounting equation: what the debit-normal accounts hold equals what the others owe.
    const owed = [
      'host_payable',
      'ramble_commission',
      'gift_liability',
      'refunds_pending',
    ] as const;
    const sum = (accounts: readonly LedgerAccount[]) =>
      accounts.reduce((total, account) => total + balances[account], 0);
    expect(
      sum(
        ledgerAccounts.filter(
          (account) => !(owed as readonly string[]).includes(account),
        ),
      ),
      `seed ${String(seed)} ${step}: assets and expenses equal what is owed`,
    ).toBe(sum(owed));
  };

  for (let step = 0; step < eventsPerRun; step++) {
    const event = rng.pick(events);
    event();
    check(`event ${String(step)}`);
  }
  for (const booking of bookings) {
    while (booking.pending.length > 0) resolveRefund(booking);
  }
  check('after resolving every refund');
  return accountBalances(rows.map((row) => LedgerEntrySchema.parse(row)));
}

describe('random sequences of money events', () => {
  it.each(seeds)(
    'seed %i keeps the books balanced and the liabilities non-negative',
    (seed) => {
      const balances = runSequence(seed);
      expect(balances.refunds_pending).toBe(0);
      expect(balances.dispute_hold).toBe(0);
    },
  );

  it('is repeatable from its seed', () => {
    expect(runSequence(7)).toEqual(runSequence(7));
  });

  it('actually posts something across the seeds', () => {
    const totals = seeds.map((seed) => runSequence(seed));
    expect(totals.some((balances) => balances.platform_cash !== 0)).toBe(true);
    expect(totals.some((balances) => balances.gift_liability > 0)).toBe(true);
    expect(totals.some((balances) => balances.dispute_losses > 0)).toBe(true);
  });
});
