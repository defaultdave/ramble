import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { maxPollAttempts, pollDelayMs } from '@/lib/orderStatus';
import type { OrderStatusResult } from '@/lib/orderStatus';
import { OrderStatusPoller } from './OrderStatusPoller';

// Behaviours under test, one per decision, branch, or risk.
// - it says the payment is being checked, and asks nothing before the first delay
// - a pending answer is asked about again on the next, longer delay
// - any settled answer has the page render again, and the asking stops
// - a lost answer does not stop the asking
// - after the cap it says so, stops asking, and offers to check again, which asks from the start
// - it asks with the reference and the token it was given, and stops when it goes away

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const reference = 'RMB-A3K7MN';
const token = 'A'.repeat(43);

function delay(attempt: number): number {
  return pollDelayMs(attempt) ?? 0;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderPoller(check: (input: unknown) => Promise<OrderStatusResult>) {
  return render(
    <OrderStatusPoller reference={reference} token={token} check={check} />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('OrderStatusPoller', () => {
  it('says the payment is being checked and asks nothing yet', () => {
    const check = vi.fn(() => Promise.resolve({ state: 'pending' as const }));
    renderPoller(check);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Checking your payment',
    );
    expect(check).not.toHaveBeenCalled();
  });

  it('asks with its reference and token, then again later, while the order is pending', async () => {
    const check = vi.fn(() => Promise.resolve({ state: 'pending' as const }));
    renderPoller(check);
    await advance(delay(0));
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith({ reference, token });
    await advance(delay(1) - 1);
    expect(check).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(check).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([
    'confirmed',
    'failed',
    'refunded_after_lapse',
    'closed',
    'unknown',
  ] as const)('has the page render again, and stops, on %s', async (state) => {
    const check = vi.fn(() => Promise.resolve({ state }));
    renderPoller(check);
    await advance(delay(0));
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(delay(maxPollAttempts));
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('keeps asking after an answer is lost', async () => {
    const check = vi
      .fn<() => Promise<OrderStatusResult>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ state: 'confirmed' });
    renderPoller(check);
    await advance(delay(0));
    expect(refresh).not.toHaveBeenCalled();
    await advance(delay(1));
    expect(check).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('gives up at the cap, says so, and asks again from the start on request', async () => {
    const check = vi.fn(() => Promise.resolve({ state: 'pending' as const }));
    renderPoller(check);
    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      await advance(delay(attempt));
    }
    expect(check).toHaveBeenCalledTimes(maxPollAttempts);
    expect(screen.getByRole('status')).toHaveTextContent(
      'This is taking longer than usual',
    );
    await advance(10 * 60 * 1000);
    expect(check).toHaveBeenCalledTimes(maxPollAttempts);

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Checking your payment',
    );
    await advance(delay(0));
    expect(check).toHaveBeenCalledTimes(maxPollAttempts + 1);
  });

  it('stops asking when it is removed', async () => {
    const check = vi.fn(() => Promise.resolve({ state: 'pending' as const }));
    const { unmount } = renderPoller(check);
    unmount();
    await advance(delay(0) * 3);
    expect(check).not.toHaveBeenCalled();
  });
});
