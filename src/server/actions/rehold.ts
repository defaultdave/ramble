'use server';

import {
  ReholdInputSchema,
  partyReserveInput,
  type ReholdResult,
} from '@/lib/pages/checkoutFlow';
import { reserveBlock, unbookableSession } from '@/lib/holds';
import { claimLapsedHold } from '@/server/db/rehold';
import { reserveSpaces } from '@/server/db/holds';
import { currentDatabaseTime } from '@/server/db/time';
import { getDevice } from '@/server/device';
import { consumeRateLimit } from '@/server/ports/rate-limit';

/**
 * Holds the same spaces again for the guest whose hold ran out at checkout (S6). The browser sends
 * only the lapsed hold's id. The hold must be the calling device's and must have lapsed on the
 * database clock; it is released in the same step, so one id re-holds at most once, and a live
 * hold, a paying one, another device's, and a missing one all get the same refusal. The bot check
 * is left out on purpose: BotID stays off checkout (ADR 0007), and the device's `reserve` tries
 * still count, so a loop of re-holds is refused like any other. A limit store that fails throws,
 * so it fails closed.
 */
export async function reholdSpaces(input: unknown): Promise<ReholdResult> {
  const parsed = ReholdInputSchema.safeParse(input);
  if (!parsed.success) return unbookableSession;
  const device = await getDevice();
  const tried = await consumeRateLimit('reserve', device.deviceKey);
  const blocked = reserveBlock('human', tried, await currentDatabaseTime());
  // Nothing has been touched yet, so this answer tells the guest a retry can work.
  if (blocked) return { status: 'try_later' };

  const lapsed = await claimLapsedHold(device, parsed.data.holdId);
  if (!lapsed) return unbookableSession;
  return reserveSpaces(device, partyReserveInput(lapsed));
}
