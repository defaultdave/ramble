import 'server-only';
import { eq, sql } from 'drizzle-orm';
import type { FakePaymentsState } from '@/server/ports/payments/fake';
import {
  emptyFakeStateDocument,
  parseFakeState,
  serializeFakeState,
} from '@/server/ports/payments/fakeState';
import { db } from './client';
import { fakeGatewayState } from './schema';

// The fake payment gateway stands in for an outside provider, so its objects outlive any one server
// process. The whole state is one jsonb row (see `fakeGatewayState`); every decision about it is made
// by the fake adapter, which runs on the state this file loads and stores.

const rowKey = 'fake';

/** The state as last committed, with no lock. A row that is missing reads as a gateway with no objects. */
export async function readFakeGatewayState(): Promise<FakePaymentsState> {
  const [row] = await db
    .select({ state: fakeGatewayState.state })
    .from(fakeGatewayState)
    .where(eq(fakeGatewayState.key, rowKey));
  return parseFakeState(row?.state ?? emptyFakeStateDocument);
}

/**
 * Runs `work` on the state under a row lock and stores what it changed, in a transaction of its own:
 * read, lock, change, write, so two callers take turns. An error thrown by `work` rolls the
 * transaction back and leaves the row as it was. Never call it inside another open transaction: the
 * fake stands in for a provider, and a provider call sits between two short transactions, never in one.
 */
export async function withFakeGatewayState<T>(
  work: (state: FakePaymentsState) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx
      .insert(fakeGatewayState)
      .values({ key: rowKey, state: emptyFakeStateDocument })
      .onConflictDoNothing();
    const [row] = await tx
      .select({ state: fakeGatewayState.state })
      .from(fakeGatewayState)
      .where(eq(fakeGatewayState.key, rowKey))
      .for('update');
    if (!row) throw new Error('The fake gateway state row is missing');
    const state = parseFakeState(row.state);
    const result = await work(state);
    await tx
      .update(fakeGatewayState)
      .set({
        state: serializeFakeState(state),
        updatedAt: sql`clock_timestamp()`,
      })
      .where(eq(fakeGatewayState.key, rowKey));
    return result;
  });
}
