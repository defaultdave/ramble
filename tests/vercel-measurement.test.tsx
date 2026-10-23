import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import CheckoutLayout from '@/app/(checkout)/layout';
import GuestLayout from '@/app/(guest)/layout';
import HostLayout from '@/app/(host)/layout';
import OpsLayout from '@/app/(ops)/layout';
import { VercelMeasurement } from '@/server/analytics/VercelMeasurement';

function rendersMeasurement(node: ReactNode): boolean {
  if (!isValidElement<{ children?: ReactNode }>(node)) return false;
  if (node.type === VercelMeasurement) return true;
  return [node.props.children].flat().some(rendersMeasurement);
}

describe('Vercel measurement scripts', () => {
  it('mounts in the guest layout', () => {
    expect(rendersMeasurement(GuestLayout({ children: null }))).toBe(true);
  });

  it.each([
    ['checkout', CheckoutLayout],
    ['host', HostLayout],
    ['ops', OpsLayout],
  ])('stays out of the %s layout', (_name, Layout) => {
    expect(rendersMeasurement(Layout({ children: null }))).toBe(false);
  });
});
