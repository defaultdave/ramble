import { describe, expect, it } from 'vitest';
import { AlertToneSchema } from './alertTone';

// Behaviours under test, one per decision, branch or risk:
// - the four tones Alert renders are accepted; anything else is not

describe('AlertToneSchema', () => {
  it.each(['info', 'success', 'warning', 'danger'])('accepts %s', (tone) => {
    expect(AlertToneSchema.safeParse(tone).success).toBe(true);
  });

  it.each(['neutral', 'error', '', 'INFO'])('refuses %j', (tone) => {
    expect(AlertToneSchema.safeParse(tone).success).toBe(false);
  });
});
