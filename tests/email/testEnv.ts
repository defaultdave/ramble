export const webhookSecret = 'test-webhook-secret-xxxxxxxxxxxxxxxxxxxxxxxx';
export const mailboxSecret = 'test-mailbox-secret-xxxxxxxxxxxxxxxxxxxxxxxxx';

/** A valid parsed environment with the email settings at their defaults. */
function emailEnv(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    EMAIL_MODE: 'sink',
    EMAIL_PROVIDER: 'fake',
    EMAIL_ALLOWLIST: [],
    ...overrides,
  };
}

/** Swaps the contents of the object a `vi.mock('@/server/env')` factory returned. */
export function setEnv(
  target: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): void {
  for (const key of Object.keys(target)) Reflect.deleteProperty(target, key);
  Object.assign(target, emailEnv(overrides));
}
