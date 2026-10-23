import { isValidElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(vercel: string | undefined) {
  vi.resetModules();
  if (vercel === undefined) vi.stubEnv('VERCEL', undefined);
  else vi.stubEnv('VERCEL', vercel);
  const { VercelMeasurement } =
    await import('@/server/analytics/VercelMeasurement');
  return {
    VercelMeasurement,
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

describe('Vercel measurement scripts', () => {
  it('mounts in the guest layout', async () => {
    const { GuestLayout, VercelMeasurement } = await load('1');
    expect(
      rendersType(GuestLayout({ children: null }), VercelMeasurement),
    ).toBe(true);
  });

  it.each(['CheckoutLayout', 'HostLayout', 'OpsLayout'] as const)(
    'stays out of the %s',
    async (name) => {
      const mod = await load('1');
      expect(
        rendersType(mod[name]({ children: null }), mod.VercelMeasurement),
      ).toBe(false);
    },
  );

  it('renders both scripts on Vercel', async () => {
    const { VercelMeasurement } = await load('1');
    const tree = VercelMeasurement();
    expect(isValidElement(tree)).toBe(true);
  });

  it.each([undefined, ''])('renders nothing when VERCEL is %j', async (v) => {
    const { VercelMeasurement } = await load(v);
    expect(VercelMeasurement()).toBeNull();
  });
});
