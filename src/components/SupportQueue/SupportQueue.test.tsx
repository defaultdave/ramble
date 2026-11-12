import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SupportQueue } from './SupportQueue';
import { openRow, resolvedRow } from './SupportQueue.fixtures';

// Behaviours under test:
// - each request shows who sent it, the reason in words, the message, and its status in words
// - an open request has a resolve form carrying its id, with a required note field named for the sender
// - a resolved request shows its note and when, and no form
// - the status filter links to the queue by status, and an empty queue says so

const noop = () => undefined;

function renderQueue(
  rows = [openRow, resolvedRow],
  nextCursor: string | null = null,
) {
  return render(
    <SupportQueue
      rows={rows}
      query={{}}
      cursor={null}
      nextCursor={nextCursor}
      resolve={noop}
    />,
  );
}

describe('SupportQueue', () => {
  it('shows the sender, reason, message and status of each request', () => {
    renderQueue();
    const open = screen.getByRole('row', { name: /Pat Smith/ });
    expect(within(open).getByText('pat@example.com')).toBeInTheDocument();
    expect(within(open).getByText('A refund or payment')).toBeInTheDocument();
    expect(within(open).getByText(/charged twice/)).toBeInTheDocument();
    expect(within(open).getByText('Open')).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Sam Lee/ })).getByText(
        'Resolved',
      ),
    ).toBeInTheDocument();
  });

  it('offers a resolve form on an open request only', () => {
    const { container } = renderQueue();
    expect(container.querySelectorAll('form')).toHaveLength(1);
    expect(container.querySelector('input[name="id"]')).toHaveValue(openRow.id);
    expect(screen.getByLabelText('Note for Pat Smith')).toBeRequired();
    expect(
      screen.getByRole('button', { name: 'Mark resolved' }),
    ).toBeInTheDocument();
  });

  it('shows the note and time of a resolved request', () => {
    renderQueue([resolvedRow]);
    expect(
      screen.getByText('Replied by phone: yes, step free.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Mon, Nov 9, 1:00 PM EST')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark resolved' })).toBeNull();
  });

  it('filters by status with links', () => {
    renderQueue();
    const filter = screen.getByRole('navigation', {
      name: 'Filter requests by status',
    });
    expect(within(filter).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      expect.stringContaining('status=open'),
    );
  });

  it('says so when there are no requests', () => {
    renderQueue([]);
    expect(screen.getByText('No support requests')).toBeInTheDocument();
  });
});
