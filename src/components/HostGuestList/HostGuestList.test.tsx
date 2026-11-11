import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostGuestList } from './HostGuestList';
import { busy, empty } from './HostGuestList.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - the page has one h1 and names the experience, time, host, and the seat total
// - each booking is a list item with the guest, party, reference, ages, waiver, and contacts
// - a guardian shows as a contact only on the booking that has one
// - no bookings says so in words, with no empty list

describe('HostGuestList', () => {
  it('names the session under one heading with the total', () => {
    render(<HostGuestList view={busy} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Guest list' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Sunset kayak · Sat, Nov 14 · 4:00 PM EST'),
    ).toBeInTheDocument();
    expect(screen.getByText('Harbor Kayak Co')).toBeInTheDocument();
    expect(screen.getByText('4 seats across 2 bookings')).toBeInTheDocument();
  });

  it('lists each booking with party, ages, waiver, and contacts', () => {
    render(<HostGuestList view={busy} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Ada Lovelace');
    expect(rows[0]).toHaveTextContent('3 seats · RMB-K7QX2M');
    expect(rows[0]).toHaveTextContent('AgesChildren aged 8, 11');
    expect(rows[0]).toHaveTextContent('WaiverAccepted');
    expect(rows[0]).toHaveTextContent('Phone+1 555 0100');
    expect(rows[0]).toHaveTextContent('GuardianAda Lovelace, ada@example.com');
    expect(rows[1]).toHaveTextContent('AgesAll attendees confirmed of age');
    expect(rows[1]).toHaveTextContent('WaiverNot accepted');
    expect(rows[1]).toHaveTextContent('Emailgrace@example.com');
  });

  it('shows no phone or guardian where the booking has none', () => {
    render(<HostGuestList view={busy} />);
    const second = screen.getAllByRole('listitem')[1];
    expect(second).toBeDefined();
    const row = within(second as HTMLElement);
    expect(row.queryByText('Phone')).not.toBeInTheDocument();
    expect(row.queryByText('Guardian')).not.toBeInTheDocument();
  });

  it('says so in words when there are no bookings', () => {
    render(<HostGuestList view={empty} />);
    expect(
      screen.getByText('No confirmed bookings for this session.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('links back to the bookings list', () => {
    render(<HostGuestList view={busy} />);
    expect(
      screen.getByRole('link', { name: 'Back to bookings' }),
    ).toHaveAttribute('href', '/host/bookings');
  });
});
