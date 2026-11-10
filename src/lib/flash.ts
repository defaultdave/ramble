import { z } from 'zod';

const FLASH_MAX_LENGTH = 200;
// The cookie carries one short message, so a larger value is not one of ours.
const FLASH_RAW_MAX_LENGTH = 400;

const flashSchema = z.strictObject({
  tone: z.enum(['success', 'info', 'warning', 'danger']),
  message: z.string().min(1).max(FLASH_MAX_LENGTH),
});

export type FlashMessage = z.infer<typeof flashSchema>;

/** TODO(U-073): first caller. The Server Action that sets the flash cookie writes this value. */
export function serializeFlash({ tone, message }: FlashMessage): string {
  return JSON.stringify({ tone, message: message.slice(0, FLASH_MAX_LENGTH) });
}

/** The flash a cookie carries. Anything that is not exactly one of ours shows nothing; it is never repaired. */
export function parseFlash(raw: string | undefined): FlashMessage | null {
  if (raw === undefined || raw.length > FLASH_RAW_MAX_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = flashSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
