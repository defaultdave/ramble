import { z } from 'zod';
import { AlertToneSchema } from './alertTone';

const FLASH_MAX_LENGTH = 200;
// The cookie carries one short message, so a larger value is not one of ours.
const FLASH_RAW_MAX_LENGTH = 400;

const flashSchema = z.strictObject({
  tone: AlertToneSchema,
  message: z.string().min(1).max(FLASH_MAX_LENGTH),
});

export type FlashMessage = z.infer<typeof flashSchema>;

export type FlashReading =
  | { ok: true; flash: FlashMessage }
  | { ok: false; reason: 'missing' | 'too-long' | 'not-json' | 'wrong-shape' };

export type FlashWriting =
  { ok: true; value: string } | { ok: false; reason: 'invalid' | 'too-long' };

/**
 * TODO(U-073): first caller. The cookie value for a flash, which the Server Action that sets the
 * cookie writes. A flash `readFlash` would refuse is refused here, never cut down to fit.
 */
export function serializeFlash(flash: FlashMessage): FlashWriting {
  const checked = flashSchema.safeParse(flash);
  if (!checked.success) return { ok: false, reason: 'invalid' };
  const value = JSON.stringify(checked.data);
  if (value.length > FLASH_RAW_MAX_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }
  return { ok: true, value };
}

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

/** TODO(U-073): first caller. What a flash cookie holds, or why it holds nothing. Nothing is repaired. */
export function readFlash(raw: string | undefined): FlashReading {
  if (raw === undefined) return { ok: false, reason: 'missing' };
  if (raw.length > FLASH_RAW_MAX_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }
  const json = parseJson(raw);
  if (!json.ok) return { ok: false, reason: 'not-json' };
  const parsed = flashSchema.safeParse(json.value);
  return parsed.success
    ? { ok: true, flash: parsed.data }
    : { ok: false, reason: 'wrong-shape' };
}

/** TODO(U-073): first caller. The flash a cookie carries, or null: a bad value shows nothing. */
export function parseFlash(raw: string | undefined): FlashMessage | null {
  const reading = readFlash(raw);
  return reading.ok ? reading.flash : null;
}
