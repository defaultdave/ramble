import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SEARCH_MAX_LENGTH } from '@/lib/tableQuery';
import { SearchField } from './SearchField';

// Behaviours under test, one per decision, branch or risk:
// - a GET search form to the table's path, with a labelled search box capped in length
// - the rest of the address rides along as hidden fields, without the cursor or its own term
// - Clear search shows only when there is a term, and keeps the rest of the address

const props = { path: '/ops/orders', label: 'Search orders' } as const;

describe('SearchField', () => {
  it('is a GET search form with a labelled, length-capped box', () => {
    render(<SearchField {...props} query={{}} value="" />);
    const form = screen.getByRole('search', { name: 'Search orders' });
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/ops/orders');
    const box = screen.getByRole('searchbox', { name: 'Search orders' });
    expect(box).toHaveAttribute('type', 'search');
    expect(box).toHaveAttribute('name', 'q');
    expect(box).toHaveAttribute('maxlength', String(SEARCH_MAX_LENGTH));
  });

  it('carries the filter and sort but not the cursor or the old term', () => {
    const { container } = render(
      <SearchField
        {...props}
        value="alex"
        query={{ q: 'alex', status: 'failed', sort: 'total', cursor: 'c1' }}
      />,
    );
    const hidden = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
    ).map((input) => [input.name, input.value]);
    expect(hidden).toEqual([
      ['status', 'failed'],
      ['sort', 'total'],
    ]);
  });

  it('fills the box with the term and offers Clear search that keeps the rest', () => {
    render(
      <SearchField
        {...props}
        value="alex"
        query={{ q: 'alex', status: 'failed' }}
      />,
    );
    expect(
      screen.getByRole('searchbox', { name: 'Search orders' }),
    ).toHaveValue('alex');
    expect(screen.getByRole('link', { name: 'Clear search' })).toHaveAttribute(
      'href',
      '/ops/orders?status=failed',
    );
  });

  it('offers no Clear search without a term', () => {
    render(<SearchField {...props} query={{}} value="" />);
    expect(
      screen.queryByRole('link', { name: 'Clear search' }),
    ).not.toBeInTheDocument();
  });
});
