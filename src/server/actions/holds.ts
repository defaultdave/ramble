'use server';

import {
  reserveBlock,
  spendsReserveTry,
  type ReleaseHoldInput,
  type ReleaseResult,
  type ReserveResult,
  type ReserveSpacesInput,
} from '@/lib/holds';
import {
  releaseHold as releaseHoldRow,
  reserveSpaces as reserveSpacesRow,
} from '@/server/db/holds';
import { currentDatabaseTime } from '@/server/db/time';
import { getDevice } from '@/server/device';
import { consumeRateLimit } from '@/server/ports/rate-limit';
import { checkBot } from '@/server/ports/rate-limit/bot-check';

/**
 * Places a hold for the calling device. The bot check and the device's try count come first, so a
 * flood is refused before it reaches a lock; a bot or a device over its limit is answered as
 * `blocked`, which writes nothing. A failed bot lookup or rate-limit store throws, so it fails closed.
 */
export async function reserveSpaces(
  input: ReserveSpacesInput,
): Promise<ReserveResult> {
  const device = await getDevice();
  const verdict = await checkBot();
  const tried = spendsReserveTry(verdict)
    ? await consumeRateLimit('reserve', device.deviceKey)
    : null;
  const blocked = reserveBlock(verdict, tried, await currentDatabaseTime());
  if (blocked) return blocked;
  return reserveSpacesRow(device, input);
}

// TODO(U-041): first caller, the booking sheet.
/** Ends the calling device's `active` hold early; a `paying` one is refused. */
export async function releaseHold(
  input: ReleaseHoldInput,
): Promise<ReleaseResult> {
  return releaseHoldRow(await getDevice(), input);
}
