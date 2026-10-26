import type { EmailAdapterName } from './message';
import type { EmailMode } from './route';

export type EmailSettings = {
  NODE_ENV: 'development' | 'test' | 'production';
  VERCEL_ENV?: 'production' | 'preview' | 'development' | undefined;
  EMAIL_MODE: EmailMode;
  EMAIL_PROVIDER: EmailAdapterName;
  EMAIL_ALLOWLIST: readonly string[];
  EMAIL_FROM?: string | undefined;
  EMAIL_REPLY_TO?: string | undefined;
  RESEND_API_KEY?: string | undefined;
  POSTMARK_SERVER_TOKEN?: string | undefined;
  EMAIL_WEBHOOK_SECRET?: string | undefined;
};

export type SettingIssue = { name: string; message: string };

/**
 * What stops the app from starting with unsafe or half-set email configuration. The default (sink
 * mode, fake provider, no keys) has no issues, so the app builds and tests with nothing set.
 */
export function emailSettingIssues(settings: EmailSettings): SettingIssue[] {
  const issues: SettingIssue[] = [];
  const need = (name: string, why: string) => {
    issues.push({ name, message: `Required ${why}` });
  };
  const provider = settings.EMAIL_PROVIDER;
  const real = provider !== 'fake';

  if (provider === 'resend' && !settings.RESEND_API_KEY) {
    need('RESEND_API_KEY', 'when EMAIL_PROVIDER is resend');
  }
  if (provider === 'postmark' && !settings.POSTMARK_SERVER_TOKEN) {
    need('POSTMARK_SERVER_TOKEN', 'when EMAIL_PROVIDER is postmark');
  }
  if (real) {
    for (const name of [
      'EMAIL_FROM',
      'EMAIL_REPLY_TO',
      'EMAIL_WEBHOOK_SECRET',
    ] as const) {
      if (!settings[name]) need(name, `when EMAIL_PROVIDER is ${provider}`);
    }
  }
  if (settings.EMAIL_MODE === 'live') {
    if (!real) {
      issues.push({
        name: 'EMAIL_PROVIDER',
        message: 'EMAIL_MODE live needs a real EMAIL_PROVIDER',
      });
    }
    const productionDeployment =
      settings.NODE_ENV === 'production' &&
      (settings.VERCEL_ENV === undefined ||
        settings.VERCEL_ENV === 'production');
    if (!productionDeployment) {
      issues.push({
        name: 'EMAIL_MODE',
        message: 'live is allowed only in a production deployment',
      });
    }
  }
  if (
    settings.EMAIL_MODE === 'allowlist' &&
    settings.EMAIL_ALLOWLIST.length === 0
  ) {
    need('EMAIL_ALLOWLIST', 'when EMAIL_MODE is allowlist');
  }
  return issues;
}
