import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAccountBookings } from '@/server/accountBookings';
import { AccountContent } from './AccountContent';

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/server/accountBookings', () => ({ loadAccountBookings: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - a signed-out visitor is sent to sign in, asking to come back to /account, and nothing is drawn for them
// - a signed-in guest sees their bookings under the page's title, and is not redirected

beforeEach(() => {
  vi.mocked(redirect).mockReset();
  vi.mocked(loadAccountBookings).mockReset();
});

describe('AccountContent', () => {
  it('sends a signed-out visitor to sign in with a same-origin next', async () => {
    vi.mocked(loadAccountBookings).mockResolvedValue({ status: 'signed_out' });
    vi.mocked(redirect).mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });

    await expect(AccountContent()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/sign-in?next=%2Faccount');
  });

  it('shows a signed-in guest their bookings', async () => {
    vi.mocked(loadAccountBookings).mockResolvedValue({
      status: 'ok',
      view: { upcoming: [], past: [] },
    });

    render(await AccountContent());

    expect(
      screen.getByRole('heading', { level: 1, name: 'My bookings' }),
    ).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });
});
