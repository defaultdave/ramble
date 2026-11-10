import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StatusTone } from '@/lib/statusBadge';
import { StatusBadge } from './StatusBadge';
import { StatusFilterBar } from './StatusFilterBar';

// Behaviours under test, one per decision, branch or risk:
// - every tone shows its words and an icon, so color is never the only signal
// - the filter bar is a labelled group of links; the chosen status is the current one
// - every link goes to the same table from the first page

const tones: StatusTone[] = ['success', 'warning', 'danger', 'info', 'neutral'];

describe('StatusBadge', () => {
  it.each(tones)('shows the label and a hidden icon for %s', (tone) => {
    const { container } = render(<StatusBadge tone={tone} label="Paid" />);
    expect(screen.getByText('Paid')).toBeVisible();
    expect(container.querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});

describe('StatusFilterBar', () => {
  const options = [
    { value: 'paid', label: 'Paid' },
    { value: 'failed', label: 'Failed', count: 2 },
  ];

  it('names the group and marks All as current when no status is chosen', () => {
    render(
      <StatusFilterBar
        path="/ops/orders"
        query={{}}
        options={options}
        label="Filter orders by status"
      />,
    );
    const group = screen.getByRole('navigation', {
      name: 'Filter orders by status',
    });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Paid' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('marks the chosen status and links each chip from the first page', () => {
    render(
      <StatusFilterBar
        path="/ops/orders"
        query={{ status: 'failed', q: 'gift', cursor: 'c1' }}
        options={options}
        label="Filter orders by status"
      />,
    );
    expect(screen.getByRole('link', { name: 'Failed (2)' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Paid' })).toHaveAttribute(
      'href',
      '/ops/orders?status=paid&q=gift',
    );
    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute(
      'href',
      '/ops/orders?q=gift',
    );
  });
});
