import 'server-only';
import Script from 'next/script';
import { sentryLoaderUrl } from '@/lib/sentryDsn';
import { env } from '@/server/env';

/**
 * Sentry's browser loader. Mounted by the guest layout only: checkout, host, and ops pages carry
 * no Sentry script (ADR 0007), which tests/sentry-browser-script.test.tsx and the checkout e2e
 * spec hold in place. Renders nothing without `SENTRY_BROWSER_DSN`.
 */
export function SentryBrowserScript() {
  const src = sentryLoaderUrl(env.SENTRY_BROWSER_DSN);
  if (!src) return null;

  return (
    <Script src={src} strategy="afterInteractive" crossOrigin="anonymous" />
  );
}
