import { z } from 'zod';

const FLASH_MAX_LENGTH = 200;
// The cookie carries one short message, so a larger value is not one of ours.
const FLASH_RAW_MAX_LENGTH = 400;

const flashSchema = z.strictObject({
  tone: z.enum(['success', 'info', 'warning', 'danger']),
  message: z.string().min(1).max(FLASH_MAX_LENGTH),
});

export type FlashMessage = z.infer<typeof flashSchema>;

export type FlashReading =
  | { ok: true; flash: FlashMessage }
  | { ok: false; reason: 'missing' | 'too-long' | 'not-json' | 'wrong-shape' };

/** TODO(U-073): first caller. The Server Action that sets the flash cookie writes this value. */
export function serializeFlash({ tone, message }: FlashMessage): string {
  return JSON.stringify({ tone, message: message.slice(0, FLASH_MAX_LENGTH) });
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
