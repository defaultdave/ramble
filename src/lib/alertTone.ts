import { z } from 'zod';

const ALERT_TONES = ['info', 'success', 'warning', 'danger'] as const;

/** The one list of alert tones: the Alert component's type and a flash's tone both come from it. */
export const AlertToneSchema = z.enum(ALERT_TONES);

export type AlertTone = z.infer<typeof AlertToneSchema>;

/** Warnings and errors interrupt a screen reader; confirmations and notes wait their turn. */
export function alertRole(tone: AlertTone): 'status' | 'alert' {
  return tone === 'warning' || tone === 'danger' ? 'alert' : 'status';
}
