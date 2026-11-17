import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PrivateRequestsQueue } from './PrivateRequestsQueue';
import {
  longRow,
  noMessageRow,
  shortRow,
} from './PrivateRequestsQueue.fixtures';

// Behaviours under test:
// - each request shows its experience, requested day, group, budget, sender, message and received time
// - a message that was cut offers the whole text behind a disclosure; a short one does not
// - a request with no message says so
// - an empty queue says so, and a next cursor links to the next page

function renderQueue(
  rows = [shortRow, longRow, noMessageRow],
  nextCursor: string | null = null,
) {
  return render(
    <PrivateRequestsQueue
      rows={rows}
      query={{}}
      cursor={null}
      nextCursor={nextCursor}
    />,
  );
}

describe('PrivateRequestsQueue', () => {
  it('shows every field of a request', () => {
    renderQueue();
    const row = screen.getByRole('row', { name: /Pat Smith/ });
    for (const text of [
      'Mon, Nov 9, 10:30 AM EST',
      'Pottery wheel night',
      'Saturday, November 21, 2026',
      '12 guests',
      '$1,200',
      'pat@example.com',
      'A birthday for the whole team.',
    ]) {
      expect(within(row).getByText(text)).toBeInTheDocument();
    }
  });

  it('puts the whole text of a cut message behind a disclosure, and only then', () => {
    const { container } = renderQueue();
    expect(container.querySelectorAll('details')).toHaveLength(1);
    const row = screen.getByRole('row', { name: /Sam Lee/ });
    expect(
      within(row).getByText(longRow.message?.preview ?? ''),
    ).toBeInTheDocument();
    expect(
      within(row).getByText(/Please tell us what the room holds/),
    ).toBeInTheDocument();
  });

  it('says when a request has no message', () => {
    renderQueue();
    expect(
      within(screen.getByRole('row', { name: /Kim Wu/ })).getByText(
        'No message',
      ),
    ).toBeInTheDocument();
  });

  it('says so for an empty queue', () => {
    renderQueue([]);
    expect(screen.getByText('No private requests')).toBeInTheDocument();
  });

  it('links to the next page when there is one', () => {
    renderQueue([shortRow], longRow.id);
    expect(screen.getByRole('link', { name: /next/i })).toHaveAttribute(
      'href',
      expect.stringContaining(`cursor=${longRow.id}`),
    );
  });
});
