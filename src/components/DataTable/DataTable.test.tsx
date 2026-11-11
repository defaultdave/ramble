import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable, type DataTableProps } from './DataTable';

// Behaviours under test, one per decision, branch or risk:
// - the sorted column says so (aria-sort); an unsorted sortable column says none; a plain column says nothing
// - a sortable header links to the flipped order from the first page, keeping the filter
// - the row header cell names its row
// - paging: no controls on a single page; Next on a page with more; First page once past the first
// - empty: the message, and a way back when the page is past the end
// - error: the table is replaced by an alert with a retry link

type Row = { id: string; name: string; total: string };

const rows: Row[] = [
  { id: 'a', name: 'Alex', total: '$10' },
  { id: 'b', name: 'Sam', total: '$20' },
];

const baseProps: DataTableProps<Row> = {
  caption: 'Orders',
  columns: [
    {
      id: 'name',
      header: 'Guest',
      cell: (row) => row.name,
      sortable: true,
      rowHeader: true,
    },
    { id: 'total', header: 'Total', cell: (row) => row.total, sortable: true },
    { id: 'note', header: 'Note', cell: () => 'none' },
  ],
  rows,
  rowId: (row) => row.id,
  path: '/ops/orders',
  query: { status: 'failed', cursor: 'c1' },
  sort: { column: 'name', direction: 'asc' },
  cursor: null,
  nextCursor: null,
  empty: { title: 'No orders yet', body: 'They show up here.' },
};

const renderTable = (props: Partial<DataTableProps<Row>> = {}) =>
  render(<DataTable {...baseProps} {...props} />);

describe('DataTable headers', () => {
  it('marks the sorted column, the unsorted sortable one, and leaves a plain one alone', () => {
    renderTable();
    const [guest, total, note] = screen.getAllByRole('columnheader');
    expect(guest).toHaveAttribute('aria-sort', 'ascending');
    expect(total).toHaveAttribute('aria-sort', 'none');
    expect(note).not.toHaveAttribute('aria-sort');
    expect(
      within(note as HTMLElement).queryByRole('link'),
    ).not.toBeInTheDocument();
  });

  it('marks a descending sort', () => {
    renderTable({ sort: { column: 'name', direction: 'desc' } });
    expect(screen.getAllByRole('columnheader')[0]).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('links the sorted column to the flipped order and another column to ascending, from the first page', () => {
    renderTable();
    expect(screen.getByRole('link', { name: 'Guest' })).toHaveAttribute(
      'href',
      '/ops/orders?status=failed&sort=name&dir=desc',
    );
    expect(screen.getByRole('link', { name: 'Total' })).toHaveAttribute(
      'href',
      '/ops/orders?status=failed&sort=total&dir=asc',
    );
  });
});

describe('DataTable rows', () => {
  it('names each row by its row header cell', () => {
    renderTable();
    expect(screen.getByRole('rowheader', { name: 'Alex' })).toHaveAttribute(
      'scope',
      'row',
    );
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('names the scrolling region and the table after the caption', () => {
    renderTable();
    expect(
      screen.getByRole('region', { name: 'Scrollable Orders' }),
    ).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('table', { name: 'Orders' })).toBeInTheDocument();
  });
});

describe('DataTable paging', () => {
  it('shows no controls on a single page', () => {
    renderTable();
    expect(
      screen.queryByRole('navigation', { name: 'Orders pages' }),
    ).not.toBeInTheDocument();
  });

  it('offers only Next on the first page when there is more', () => {
    renderTable({ nextCursor: 'b' });
    const pages = screen.getByRole('navigation', { name: 'Orders pages' });
    expect(
      within(pages).getByRole('link', { name: 'Next page' }),
    ).toHaveAttribute('href', '/ops/orders?status=failed&cursor=b');
    expect(
      within(pages).queryByRole('link', { name: 'First page' }),
    ).not.toBeInTheDocument();
  });

  it('offers First page past the first, and no Next on the last page', () => {
    renderTable({ cursor: 'a' });
    const pages = screen.getByRole('navigation', { name: 'Orders pages' });
    expect(
      within(pages).getByRole('link', { name: 'First page' }),
    ).toHaveAttribute('href', '/ops/orders?status=failed');
    expect(
      within(pages).queryByRole('link', { name: 'Next page' }),
    ).not.toBeInTheDocument();
  });
});

describe('DataTable empty and error states', () => {
  it('says why there is nothing and shows no table', () => {
    renderTable({ rows: [] });
    expect(screen.getByText('No orders yet')).toBeVisible();
    expect(screen.getByText('They show up here.')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Back to the first page' }),
    ).not.toBeInTheDocument();
  });

  it('offers the first page when empty past the end', () => {
    renderTable({ rows: [], cursor: 'zz' });
    expect(
      screen.getByRole('link', { name: 'Back to the first page' }),
    ).toHaveAttribute('href', '/ops/orders?status=failed');
  });

  it('replaces the table with an alert and a retry link on error', () => {
    renderTable({
      error: {
        title: 'Orders could not load',
        body: 'Try again.',
        retryHref: '/ops/orders?status=failed',
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Orders could not load',
    );
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/ops/orders?status=failed',
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
