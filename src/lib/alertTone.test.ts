import { describe, expect, it } from 'vitest';
import { alertRole, AlertToneSchema } from './alertTone';

// Behaviours under test, one per decision, branch or risk:
// - the four tones Alert renders are accepted; anything else is not
// - warnings and errors are announced as alerts, confirmations and notes as status

describe('AlertToneSchema', () => {
  it.each(['info', 'success', 'warning', 'danger'])('accepts %s', (tone) => {
    expect(AlertToneSchema.safeParse(tone).success).toBe(true);
  });

  it.each(['neutral', 'error', '', 'INFO'])('refuses %j', (tone) => {
    expect(AlertToneSchema.safeParse(tone).success).toBe(false);
  });
});

describe('alertRole', () => {
  it.each([
    ['info', 'status'],
    ['success', 'status'],
    ['warning', 'alert'],
    ['danger', 'alert'],
  ] as const)('%s is %s', (tone, role) => {
    expect(alertRole(tone)).toBe(role);
  });
});
