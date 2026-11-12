import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  blockedImpact,
  blockedSession,
  bookedImpact,
  cancelledSession,
  emptyImpact,
  openSession,
  sessionRows,
} from './OpsSessions.fixtures';
import { SessionDetail } from './SessionDetail';
import { SessionsList } from './SessionsList';

// Behaviours under test:
// - each session shows when, experience, host, sold, held, capacity and status, and links to its page
// - the upcoming and past filters and the search are in the page, and an empty list says so
// - the impact is shown before the cancel form, with each booking and its amount
// - the cancel form carries the session and the impact it was shown for, and a reason without the host's
// - the cancel button is off for a session that cannot be cancelled, and a blocking booking is named in words

const noop = () => undefined;

function renderList(rows = sessionRows) {
  return render(
    <SessionsList
      rows={rows}
      query={{}}
      term=""
      direction="desc"
      cursor={null}
      nextCursor={null}
    />,
  );
}

function renderDetail(
  props: Partial<Parameters<typeof SessionDetail>[0]> = {},
) {
  return render(
    <SessionDetail
      session={openSession}
      impact={bookedImpact}
      actions={{ cancel: noop }}
      {...props}
    />,
  );
}

describe('SessionsList', () => {
  it('shows the facts of each session and links to its page', () => {
    renderList();
    const row = screen.getByRole('row', { name: /Harbor sunrise kayak/ });
    expect(within(row).getByText('Tidewater Outfitters')).toBeInTheDocument();
    expect(within(row).getByText('Scheduled')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /Nov 14/ })).toHaveAttribute(
      'href',
      `/ops/sessions/${sessionRows[0]?.id ?? ''}`,
    );
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(expect.arrayContaining(['5', '2', '12']));
  });

  it('offers the when filter and the search, and says so when nothing matches', () => {
    renderList([]);
    const filter = screen.getByRole('navigation', {
      name: 'Filter sessions by when they start',
    });
    expect(within(filter).getByRole('link', { name: 'Past' })).toHaveAttribute(
      'href',
      expect.stringContaining('status=past'),
    );
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByText('No sessions match')).toBeInTheDocument();
  });
});

describe('SessionDetail', () => {
  it('shows the impact, with each booking and its amount, before the form', () => {
    const { container } = renderDetail();
    expect(
      screen.getByText(/2 bookings refunded in full, \$367\.20 in all/),
    ).toBeInTheDocument();
    expect(screen.getByText('RMB-4F7K2Q')).toBeInTheDocument();
    const impact = screen.getByRole('heading', { name: 'Who this affects' });
    expect(
      impact.compareDocumentPosition(container.querySelector('form') as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('carries the session and the impact shown in the cancel form, with an ops reason', () => {
    const { container } = renderDetail();
    expect(container.querySelector('input[name="sessionId"]')).toHaveValue(
      openSession.id,
    );
    expect(container.querySelector('input[name="fingerprint"]')).toHaveValue(
      bookedImpact.fingerprint,
    );
    expect(screen.getByLabelText('Reason')).toHaveValue('ramble');
    expect(screen.getByLabelText('Reason')).not.toHaveTextContent('Host');
    expect(
      screen.getByRole('button', {
        name: 'Cancel session and refund its bookings',
      }),
    ).toBeEnabled();
  });

  it.each([
    ['a cancelled session', { session: cancelledSession, impact: emptyImpact }],
    [
      'a booking that blocks it',
      { session: blockedSession, impact: blockedImpact },
    ],
  ])('turns the cancel button off for %s', (_name, props) => {
    renderDetail(props);
    expect(
      screen.getByRole('button', {
        name: 'Cancel session and refund its bookings',
      }),
    ).toBeDisabled();
  });

  it('names the blocking bookings and why', () => {
    renderDetail({ session: blockedSession, impact: blockedImpact });
    expect(
      screen.getByText(/RMB-9TT3XM paid in part by a gift/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/RMB-2B8C5D has no payment to send the money back to/),
    ).toBeInTheDocument();
  });
});
