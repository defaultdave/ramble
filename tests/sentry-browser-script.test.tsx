import { isValidElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// next/font only runs inside the Next.js compiler, so the layouts get a stand-in.
vi.mock('@/app/fonts', () => ({ fontVariables: '' }));

const browserDsn =
  'https://0123456789abcdef0123456789abcdef@o0.ingest.sentry.io/1';

async function load(dsn: string | undefined) {
  vi.resetModules();
  vi.stubEnv('SENTRY_BROWSER_DSN', dsn);
  const { SentryBrowserScript } =
    await import('@/server/monitoring/SentryBrowserScript');
  return {
    SentryBrowserScript,
    GuestLayout: (await import('@/app/(guest)/layout')).default,
    CheckoutLayout: (await import('@/app/(checkout)/layout')).default,
    HostLayout: (await import('@/app/(host)/layout')).default,
    OpsLayout: (await import('@/app/(ops)/layout')).default,
  };
}

function rendersType(node: ReactNode, type: unknown): boolean {
  if (!isValidElement<{ children?: ReactNode }>(node)) return false;
  if (node.type === type) return true;
  return [node.props.children].flat().some((c) => rendersType(c, type));
}

afterEach(() => vi.unstubAllEnvs());

describe('Sentry browser script', () => {
  it('mounts in the guest layout', async () => {
    const { GuestLayout, SentryBrowserScript } = await load(browserDsn);

    expect(
      rendersType(GuestLayout({ children: null }), SentryBrowserScript),
    ).toBe(true);
  });

  it.each(['CheckoutLayout', 'HostLayout', 'OpsLayout'] as const)(
    'stays out of the %s',
    async (name) => {
      const mod = await load(browserDsn);

      expect(
        rendersType(mod[name]({ children: null }), mod.SentryBrowserScript),
      ).toBe(false);
    },
  );

  it('loads Sentry loader script for the browser DSN', async () => {
    const { SentryBrowserScript } = await load(browserDsn);

    const tree = SentryBrowserScript();

    expect(isValidElement<{ src: string }>(tree)).toBe(true);
    expect((tree as { props: { src: string } }).props.src).toBe(
      'https://js.sentry-cdn.com/0123456789abcdef0123456789abcdef.min.js',
    );
  });

  it.each([undefined, ''])(
    'renders nothing when the DSN is %j',
    async (dsn) => {
      const { SentryBrowserScript } = await load(dsn);

      expect(SentryBrowserScript()).toBeNull();
    },
  );
});
