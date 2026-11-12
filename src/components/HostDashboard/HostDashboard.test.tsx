import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hostNavLinks } from '@/lib/hostStaff';
import { HostDashboard } from './HostDashboard';
import { busy, empty } from './HostDashboard.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - the page has one h1, names the host, and offers sign out
// - each upcoming session is a list item with its experience, time, and seats sold against the allocation
// - each booking is a list item with the guest, seats, total, status, and reference
// - no sessions and no bookings each say so in words, with no empty list
// - the two lists are labelled sections, so a screen reader can jump between them
// - an owner is offered session management and the staff page; host staff are offered a link to the sessions and nothing to manage

describe('HostDashboard', () => {
  it('names the host under one heading and offers sign out', () => {
    render(<HostDashboard view={busy} links={hostNavLinks(true)} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Host dashboard' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Harbor Kayak Co')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Sign out' }),
    ).toBeInTheDocument();
  });

  it('lists upcoming sessions with seats sold against the allocation', () => {
    render(<HostDashboard view={busy} links={hostNavLinks(true)} />);
    const section = screen.getByRole('region', { name: 'Upcoming sessions' });
    const rows = within(section).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Sunset kayak');
    expect(rows[0]).toHaveTextContent('Sat, Nov 14 · 4:00 PM EST');
    expect(rows[0]).toHaveTextContent('5 of 12 seats sold');
    expect(rows[2]).toHaveTextContent('8 of 8 seats sold');
    // The bar steps in tenths, rounded down: 5 of 12 is 41 percent, a full session is the last step.
    expect(rows[0]?.querySelector('[data-fill]')).toHaveAttribute(
      'data-fill',
      '4',
    );
    expect(rows[2]?.querySelector('[data-fill]')).toHaveAttribute(
      'data-fill',
      '10',
    );
  });

  it('lists recent bookings with guest, seats, total, status, and reference', () => {
    render(<HostDashboard view={busy} links={hostNavLinks(true)} />);
    const section = screen.getByRole('region', { name: 'Recent bookings' });
    const rows = within(section).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Ada Lovelace');
    expect(rows[0]).toHaveTextContent('3 seats · $255.00 · Confirmed');
    expect(rows[0]).toHaveTextContent('RMB-K7QX2M');
    expect(rows[1]).toHaveTextContent('1 seat · $75.00 · Cancelled');
  });

  it('says so when there are no sessions or bookings', () => {
    render(<HostDashboard view={empty} links={hostNavLinks(true)} />);
    expect(screen.getByText('No sessions are scheduled yet.')).toBeVisible();
    expect(screen.getByText('No bookings yet.')).toBeVisible();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('offers an owner session management and the staff page', () => {
    render(<HostDashboard view={busy} links={hostNavLinks(true)} />);
    const nav = screen.getByRole('navigation', { name: 'Host pages' });
    expect(
      within(nav).getByRole('link', { name: 'Manage sessions' }),
    ).toHaveAttribute('href', '/host/sessions');
    expect(within(nav).getByRole('link', { name: 'Staff' })).toHaveAttribute(
      'href',
      '/host/staff',
    );
  });

  it('offers host staff the sessions to look at and no staff page', () => {
    render(<HostDashboard view={busy} links={hostNavLinks(false)} />);
    expect(screen.getByRole('link', { name: 'Sessions' })).toHaveAttribute(
      'href',
      '/host/sessions',
    );
    expect(screen.queryByRole('link', { name: 'Staff' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Manage sessions' })).toBeNull();
  });
});
