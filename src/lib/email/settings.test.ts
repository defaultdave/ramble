import { describe, expect, it } from 'vitest';
import { emailSettingIssues, type EmailSettings } from './settings';

// Behaviours under test, one per rule:
// - the default (sink, fake, nothing else set) has no issues
// - a real provider needs its own key, a sender, a reply-to, and a webhook secret
// - live needs a real provider and a production deployment, not a preview or development one
// - allowlist needs at least one entry

const defaults: EmailSettings = {
  NODE_ENV: 'test',
  EMAIL_MODE: 'sink',
  EMAIL_PROVIDER: 'fake',
  EMAIL_ALLOWLIST: [],
};

const resendComplete: EmailSettings = {
  ...defaults,
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 'key',
  EMAIL_FROM: 'Ramble <hello@example.com>',
  EMAIL_REPLY_TO: 'support@example.com',
  EMAIL_WEBHOOK_SECRET: 'x'.repeat(32),
};

const names = (settings: EmailSettings) =>
  emailSettingIssues(settings).map(({ name }) => name);

describe('emailSettingIssues', () => {
  it('has none for the default, so the app starts with nothing set', () => {
    expect(emailSettingIssues(defaults)).toEqual([]);
  });

  it('has none for a complete Resend setup', () => {
    expect(emailSettingIssues(resendComplete)).toEqual([]);
  });

  it.each([
    ['RESEND_API_KEY'],
    ['EMAIL_FROM'],
    ['EMAIL_REPLY_TO'],
    ['EMAIL_WEBHOOK_SECRET'],
  ] as const)('wants %s once Resend is the provider', (missing) => {
    expect(names({ ...resendComplete, [missing]: undefined })).toEqual([
      missing,
    ]);
  });

  it('wants the Postmark token, not the Resend key, once Postmark is the provider', () => {
    expect(names({ ...resendComplete, EMAIL_PROVIDER: 'postmark' })).toEqual([
      'POSTMARK_SERVER_TOKEN',
    ]);
  });

  describe('live mode', () => {
    const live = {
      ...resendComplete,
      NODE_ENV: 'production',
      EMAIL_MODE: 'live',
    } as const;

    it('is allowed in production and in a production deployment', () => {
      expect(emailSettingIssues(live)).toEqual([]);
      expect(emailSettingIssues({ ...live, VERCEL_ENV: 'production' })).toEqual(
        [],
      );
    });

    it.each([
      ['a development build', { NODE_ENV: 'development' }],
      ['a test run', { NODE_ENV: 'test' }],
      ['a Vercel preview', { VERCEL_ENV: 'preview' }],
      ['a Vercel development environment', { VERCEL_ENV: 'development' }],
    ] as const)('is refused in %s', (_label, override) => {
      expect(names({ ...live, ...override })).toEqual(['EMAIL_MODE']);
    });

    it('is refused with the fake provider', () => {
      expect(names({ ...live, EMAIL_PROVIDER: 'fake' })).toEqual([
        'EMAIL_PROVIDER',
      ]);
    });
  });

  describe('allowlist mode', () => {
    it('wants an entry', () => {
      expect(names({ ...defaults, EMAIL_MODE: 'allowlist' })).toEqual([
        'EMAIL_ALLOWLIST',
      ]);
    });

    it('is fine with one', () => {
      expect(
        emailSettingIssues({
          ...defaults,
          EMAIL_MODE: 'allowlist',
          EMAIL_ALLOWLIST: ['dave@example.com'],
        }),
      ).toEqual([]);
    });
  });
});
