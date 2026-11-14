import { describe, expect, it } from 'vitest';
import { isResetConfirmed, resetRefusal } from './resetTarget';

// Behaviours under test:
// - a production deployment is refused, whatever the seed target says
// - the production-demo database is refused even from a shell with no VERCEL_ENV
// - preview, development, an unset environment and the other seed targets are not refused here
// - only the exact word confirms; spaces around it are let through, other cases and extra text are not

describe('resetRefusal', () => {
  it.each([
    [{ vercelEnv: 'production', seedTarget: undefined }],
    [{ vercelEnv: 'production', seedTarget: 'staging' }],
    [{ vercelEnv: undefined, seedTarget: 'production-demo' }],
    [{ vercelEnv: 'preview', seedTarget: 'production-demo' }],
  ])('refuses %j', (input) => {
    expect(resetRefusal(input)).toEqual(expect.any(String));
  });

  it.each([
    [{ vercelEnv: 'preview', seedTarget: undefined }],
    [{ vercelEnv: 'development', seedTarget: 'local' }],
    [{ vercelEnv: undefined, seedTarget: 'staging' }],
    [{ vercelEnv: undefined, seedTarget: 'load-test' }],
  ])('does not refuse %j', (input) => {
    expect(resetRefusal(input)).toBeNull();
  });
});

describe('isResetConfirmed', () => {
  it.each([['RESET'], ['  RESET\n']])('accepts %j', (typed) => {
    expect(isResetConfirmed(typed)).toBe(true);
  });

  it.each([[undefined], [''], ['reset'], ['RESET it'], ['yes']])(
    'refuses %j',
    (typed) => {
      expect(isResetConfirmed(typed)).toBe(false);
    },
  );
});
