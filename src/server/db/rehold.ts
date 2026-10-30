import 'server-only';
import { eq } from 'drizzle-orm';
import { EntityIdSchema } from '@/lib/catalog';
import {
  isHoldOfDevice,
  isLapsedHold,
  requireHoldTransition,
} from '@/lib/holds';
import { MAX_LINES } from '@/lib/pricing';
import type { Device } from '@/server/device';
import { db } from './client';
import { lockHoldRow, lockSessionRow } from './locks';
import { holdItems, holds } from './schema';
import { readDatabaseTime } from './time';

export type LapsedParty = {
  sessionId: string;
  party: { priceOptionId: string; quantity: number }[];
};

/**
 * Takes a lapsed hold for holding again, once. The hold's session id is read with no lock, then
 * the session and the hold are locked in that order and the hold is judged again at database time
 * (design doc 4.2.3 rule 1). Only the calling device's `active` booking hold that has run out
 * qualifies; it is then released as `expired`, so a second call with the same id finds it released
 * and answers null, alike for another device's hold, a missing one, and a live one. The party
 * comes from the hold's own lines, never from the browser. The caller reserves the spaces next; a
 * hold that lapsed takes no space, so releasing it first frees nothing it was keeping.
 */
export async function claimLapsedHold(
  device: Device,
  holdId: string,
): Promise<LapsedParty | null> {
  const id = EntityIdSchema.safeParse(holdId);
  if (!id.success) return null;

  return db.transaction(async (tx) => {
    const [read] = await tx
      .select({ sessionId: holds.sessionId })
      .from(holds)
      .where(eq(holds.id, id.data));
    if (!read) return null;

    await lockSessionRow(tx, read.sessionId);
    const hold = await lockHoldRow(tx, id.data);
    const at = await readDatabaseTime(tx);
    if (
      !isHoldOfDevice(hold, device.deviceKey) ||
      hold.sessionId !== read.sessionId ||
      hold.purpose !== 'booking' ||
      !isLapsedHold(hold, at)
    ) {
      return null;
    }

    requireHoldTransition(hold.status, 'released');
    const lines = await tx
      .select({
        priceOptionId: holdItems.priceOptionId,
        quantity: holdItems.quantity,
      })
      .from(holdItems)
      .where(eq(holdItems.holdId, hold.id))
      .limit(MAX_LINES + 1);
    await tx
      .update(holds)
      .set({ status: 'released', releasedReason: 'expired', updatedAt: at })
      .where(eq(holds.id, hold.id));
    return { sessionId: hold.sessionId, party: lines };
  });
}
