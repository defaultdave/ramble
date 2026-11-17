import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HostCancelSession } from './HostCancelSession';
import {
  blocked,
  cancelled,
  ready,
  sessionId,
} from './HostCancelSession.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - the page has one h1 and names the session, its seats and status, with the way back to the week
// - who is affected comes before the form: the summary, each booking and its refund, and the count not listed
// - the form carries the session and the impact that was read, a box to confirm it, and the submit that posts them
// - a session that cannot be cancelled shows its reason and the blocked booking, and no form
// - a cancelled session says so and offers no second cancellation

const action = vi.fn<(formData: FormData) => void>();

describe('HostCancelSession', () => {
  it('names the session under one heading, with the way back', () => {
    render(<HostCancelSession view={ready} action={action} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Cancel session' }),
    ).toBeInTheDocument();
    expect(screen.getByText('4 of 8 seats sold')).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Back to your sessions' }),
    ).toHaveAttribute('href', '/host/sessions');
  });

  it('says who is affected and what each is refunded before the form', () => {
    render(<HostCancelSession view={ready} action={action} />);
    const impact = screen.getByRole('heading', { name: 'Who this affects' });
    const confirm = screen.getByRole('heading', {
      name: 'Confirm the cancellation',
    });
    expect(
      impact.compareDocumentPosition(confirm) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText(/2 bookings refunded in full/)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('RMB-0001')).toBeInTheDocument();
  });

  it('says how many bookings are not listed', () => {
    render(
      <HostCancelSession
        view={{
          ...ready,
          impact: { ...ready.impact, moreLabel: 'and 3 more' },
        }}
        action={action}
      />,
    );
    expect(screen.getByText('and 3 more')).toBeInTheDocument();
  });

  it('posts the session, the impact read and the ticked box', async () => {
    const user = userEvent.setup();
    render(<HostCancelSession view={ready} action={action} />);
    await user.click(
      screen.getByRole('checkbox', { name: 'I have read who this affects' }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Cancel session and refund its bookings',
      }),
    );
    const data = action.mock.calls[0]?.[0];
    expect([
      data?.get('sessionId'),
      data?.get('fingerprint'),
      data?.get('confirm'),
    ]).toEqual([sessionId, '2:21600:1:2:1:0', 'on']);
  });

  it('shows the reason and the blocked booking, and no form, for a session that cannot be cancelled', () => {
    render(<HostCancelSession view={blocked} action={action} />);
    expect(screen.getByText(/RMB-0003 paid in part by a gift/)).toBeVisible();
    expect(screen.getByText(/Contact Ramble support/)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Cancel session/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('says a cancelled session is cancelled and offers no form', () => {
    render(<HostCancelSession view={cancelled} action={action} />);
    expect(screen.getByText(/This session is cancelled/)).toBeVisible();
    expect(screen.getByText('Cancelled')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Cancel session/ }),
    ).not.toBeInTheDocument();
  });
});
