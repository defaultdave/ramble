import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import CheckoutError from '@/app/(checkout)/error';
import GuestError from '@/app/(guest)/error';
import HostError from '@/app/(host)/error';
import OpsError from '@/app/(ops)/error';
import GlobalError from '@/app/global-error';
import { ErrorNotice } from '@/components/ErrorNotice';

function findElement(
  node: ReactNode,
  type: unknown,
): ReactElement<Record<string, unknown>> | undefined {
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  if (node.type === type) return node;
  const children = [node.props.children].flat() as ReactNode[];
  for (const child of children) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return undefined;
}

describe('Try again', () => {
  it('runs the retry function the button was given', () => {
    const retry = vi.fn();

    const button = findElement(ErrorNotice({ onRetry: retry }), 'button');
    (button?.props.onClick as () => void)();

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['guest', GuestError],
    ['checkout', CheckoutError],
    ['host', HostError],
    ['ops', OpsError],
    ['root', GlobalError],
  ])('is wired to the retry Next gives the %s boundary', (_name, Boundary) => {
    const retry = vi.fn();

    const notice = findElement(Boundary({ retry }), ErrorNotice);

    expect(notice?.props.onRetry).toBe(retry);
  });
});
