import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostGuestLists } from './HostGuestLists';
import { all, none, noMatch, searched } from './HostGuestLists.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - the page has one h1 and a labelled GET search form on the bookings path
// - the search box carries the term searched for, and a cleared search offers no clear link
// - each booking is a list item with guest, experience, time, seats, status, reference, and a link to its session's guest list
// - the summary is announced as a status and says what was found
// - no match and no bookings each say so in words, with no empty list

describe('HostGuestLists', () => {
  it('has one heading and a search form that GETs the bookings path', () => {
    render(<HostGuestLists view={all} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Bookings' }),
    ).toBeInTheDocument();
    const form = screen.getByRole('search', { name: 'Search bookings' });
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/host/bookings');
    expect(
      screen.getByRole('searchbox', { name: 'Search bookings' }),
    ).toHaveValue('');
    expect(
      screen.queryByRole('link', { name: 'Clear search' }),
    ).not.toBeInTheDocument();
  });

  it('lists each booking and links it to its session’s guest list', () => {
    render(<HostGuestLists view={all} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Ada Lovelace');
    expect(rows[0]).toHaveTextContent(
      'Sunset kayak · Sun, Nov 15 · 4:00 PM EST',
    );
    expect(rows[0]).toHaveTextContent('3 seats · Confirmed · RMB-K7QX2M');
    expect(rows[1]).toHaveTextContent('1 seat · Cancelled · RMB-P4ZT9C');
    expect(
      screen.getAllByRole('link', { name: 'Guest list for this session' })[0],
    ).toHaveAttribute(
      'href',
      '/host/bookings/session/00000000-0000-4000-8000-000000000001',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Latest 2 bookings');
  });

  it('keeps the term in the box and offers to clear it', () => {
    render(<HostGuestLists view={searched} />);
    expect(screen.getByRole('searchbox')).toHaveValue('ada');
    expect(screen.getByRole('link', { name: 'Clear search' })).toHaveAttribute(
      'href',
      '/host/bookings',
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 booking matches “ada”',
    );
  });

  it.each([
    ['no match', noMatch, 'No bookings match “zed”'],
    ['no bookings', none, 'No bookings yet'],
  ])('says so in words for %s, with no list', (_name, view, words) => {
    render(<HostGuestLists view={view} />);
    expect(screen.getByRole('status')).toHaveTextContent(words);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
