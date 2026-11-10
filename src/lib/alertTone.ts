import { z } from 'zod';

const ALERT_TONES = ['info', 'success', 'warning', 'danger'] as const;

/** The one list of alert tones: the Alert component's type and a flash's tone both come from it. */
export const AlertToneSchema = z.enum(ALERT_TONES);

export type AlertTone = z.infer<typeof AlertToneSchema>;
