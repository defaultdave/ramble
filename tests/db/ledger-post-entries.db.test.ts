import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  bookingPaid,
  cardFee,
  refundRequested,
  type LedgerEntryInput,
} from '@/lib/ledger';
import {
  client,
  common,
  countRows,
  newBooking,
  nextProviderId,
  openLedgerDatabase,
  post,
  postIn,
  worked,
  type Row,
} from './ledgerFixtures';

// Behaviours under test, one per decision, branch or risk.
// postEntries:
// - posts an event and counts it; a repeated cash event posts nothing and says already_posted; a different id posts
// - a half-posted cash event throws and writes nothing, even when the caller catches the error
// - an invalid row, a mixed event, an empty event, and an oversized event write nothing
// - a non-cash event posts every time it is called (its caller's own row is what makes it once)
// - it joins the caller's transaction: a rollback leaves nothing; the recording time is taken after a wait inside the transaction
// - 12 parallel calls for one cash event post it once

openLedgerDatabase();

describe('postEntries', () => {
  it('posts an event, counts its rows, and fills the recorded fields', async () => {
    const booking = await newBooking();
    const rows = bookingPaid({
      ...common,
      ...booking,
      providerObjectId: nextProviderId(),
      split: { ...worked, taxMinor: 100 },
    });
    expect(await post(rows)).toEqual({ status: 'posted', count: 3 });
    expect(await countRows(sql`order_id = ${booking.orderId}`)).toBe(3);
    const { rows: stored } = await client.db.execute<Row>(
      sql`SELECT entry_type, amount_minor, currency, simulated, host_id, payment_attempt_id FROM ledger_entries WHERE order_id = ${booking.orderId} ORDER BY id`,
    );
    expect(stored.map((row) => [row.entry_type, row.amount_minor])).toEqual([
      ['charge_host_share', 11050],
      ['charge_commission', 1950],
      ['charge_tax', 100],
    ]);
    expect(stored[0]).toMatchObject({
      currency: 'USD',
      simulated: true,
      host_id: booking.hostId,
      payment_attempt_id: booking.paymentAttemptId,
    });
  });

  it('posts a repeated cash event once and says so the second time', async () => {
    const booking = await newBooking();
    const rows = bookingPaid({
      ...common,
      ...booking,
      providerObjectId: nextProviderId(),
      split: worked,
    });
    expect(await post(rows)).toMatchObject({ status: 'posted' });
    expect(await post(rows)).toEqual({ status: 'already_posted' });
    expect(await countRows(sql`order_id = ${booking.orderId}`)).toBe(2);
  });

  it('posts another provider id for the same booking as a new event', async () => {
    const booking = await newBooking();
    const fee = (providerObjectId: string) =>
      cardFee({ ...common, ...booking, providerObjectId, amountMinor: 407 });
    expect(await post(fee(nextProviderId()))).toMatchObject({
      status: 'posted',
    });
    expect(await post(fee(nextProviderId()))).toMatchObject({
      status: 'posted',
    });
    expect(await countRows(sql`order_id = ${booking.orderId}`)).toBe(2);
  });

  it('throws on a half-posted cash event and writes nothing, even when the caller catches it', async () => {
    const booking = await newBooking();
    const providerObjectId = nextProviderId();
    await post(
      bookingPaid({
        ...common,
        ...booking,
        providerObjectId,
        split: worked,
      }).slice(0, 1),
    );
    const full = bookingPaid({
      ...common,
      ...booking,
      providerObjectId,
      split: { ...worked, taxMinor: 100 },
    });
    await client.db.transaction(async (tx) => {
      await expect(postIn(tx, full)).rejects.toThrow(/Half-posted/);
      // The caller's transaction is still usable, and the savepoint kept the new rows out.
      expect(await postIn(tx, plainEvent(booking))).toMatchObject({
        status: 'posted',
      });
    });
    expect(
      await countRows(
        sql`order_id = ${booking.orderId} AND provider_object_id IS NOT NULL`,
      ),
    ).toBe(1);
    expect(await countRows(sql`order_id = ${booking.orderId}`)).toBe(2);
  });

  function plainEvent(booking: { orderId: string; hostId: string }) {
    return refundRequested({
      ...common,
      orderId: booking.orderId,
      hostId: booking.hostId,
      refundId: randomUUID().replace(/^./, 'a'),
      split: { ticketMinor: 500, commissionMinor: 0, taxMinor: 0 },
    }).map((row) => ({ ...row, refundId: null }));
  }

  it('writes nothing for an invalid row, a mixed event, an empty event, or an oversized one', async () => {
    const booking = await newBooking();
    const good = bookingPaid({
      ...common,
      ...booking,
      providerObjectId: nextProviderId(),
      split: worked,
    });
    const cashOne = good[0] as LedgerEntryInput;
    const mixed = [cashOne, ...plainEvent(booking)];
    const oversized = Array.from(
      { length: 4 },
      () => plainEvent(booking)[0] as LedgerEntryInput,
    );
    await expect(
      post([
        good[0] as LedgerEntryInput,
        { ...(good[1] as LedgerEntryInput), amountMinor: 0 },
      ]),
    ).rejects.toThrow();
    await expect(post(mixed)).rejects.toThrow();
    await expect(post([])).rejects.toThrow();
    await expect(post(oversized)).rejects.toThrow(RangeError);
    await expect(
      post([{ ...cashOne, providerObjectId: null }]),
    ).rejects.toThrow();
    expect(await countRows(sql`order_id = ${booking.orderId}`)).toBe(0);
  });

  it('posts a non-cash event every time it is called', async () => {
    const booking = await newBooking();
    const rows = plainEvent(booking);
    await post(rows);
    await post(rows);
    expect(await countRows(sql`order_id = ${booking.orderId}`)).toBe(2);
  });

  it('joins the caller transaction, so a rollback leaves nothing', async () => {
    const booking = await newBooking();
    await expect(
      client.db.transaction(async (tx) => {
        await postIn(
          tx,
          bookingPaid({
            ...common,
            ...booking,
            providerObjectId: nextProviderId(),
            split: worked,
          }),
        );
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    expect(await countRows(sql`order_id = ${booking.orderId}`)).toBe(0);
  });

  it('takes the recording time from clock_timestamp() after a wait inside the transaction', async () => {
    const booking = await newBooking();
    await client.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_sleep(0.05)`);
      await postIn(
        tx,
        cardFee({
          ...common,
          ...booking,
          providerObjectId: nextProviderId(),
          amountMinor: 407,
        }),
      );
      const { rows } = await tx.execute<{ later: boolean }>(
        sql`SELECT recorded_at > transaction_timestamp() AS later FROM ledger_entries WHERE order_id = ${booking.orderId}`,
      );
      expect(rows[0]?.later).toBe(true);
    });
  });

  it('posts a cash event once when 12 calls race', async () => {
    const booking = await newBooking();
    const rows = bookingPaid({
      ...common,
      ...booking,
      providerObjectId: nextProviderId(),
      split: { ...worked, taxMinor: 100 },
    });
    const answers = await Promise.all(
      Array.from({ length: 12 }, () => post(rows)),
    );
    expect(answers.filter((answer) => answer.status === 'posted')).toHaveLength(
      1,
    );
    expect(
      answers.filter((answer) => answer.status === 'already_posted'),
    ).toHaveLength(11);
    expect(await countRows(sql`order_id = ${booking.orderId}`)).toBe(3);
  });
});
