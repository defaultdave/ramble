import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { ButtonLink } from '@/components/Button';
import { classNames } from '@/lib/classNames';
import {
  ariaSortFor,
  firstPageHref,
  nextPageHref,
  sortHref,
  type SortState,
  type TableQuery,
} from '@/lib/tableQuery';
import styles from './DataTable.module.css';

export type DataTableColumn<Row> = {
  /** Names the column in the address when it is sortable, so it is a fixed word, never a label. */
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  sortable?: boolean;
  /** The cell that names its row for a screen reader. One column should have it. */
  rowHeader?: boolean;
  align?: 'start' | 'end';
};

export type DataTableProps<Row> = {
  /** Names the table for a screen reader and the scrolling region around it. */
  caption: string;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  rowId: (row: Row) => string;
  /** The table's own path and the address's params now: every sort and page link is built from them. */
  path: string;
  query: TableQuery;
  sort: SortState;
  /** Where this page started, or null on the first page. */
  cursor: string | null;
  /** Where the next page starts, or null on the last. Comes from `splitPage`. */
  nextCursor: string | null;
  empty: { title: string; body?: string };
  /** When the read failed. The table is not shown; the retry link goes to where the table was asked for. */
  error?: { title: string; body?: string; retryHref: string } | null;
};

const alignClass = {
  start: undefined,
  end: styles.end,
} satisfies Record<'start' | 'end', string | undefined>;

function SortIcon({
  direction,
}: {
  direction: 'ascending' | 'descending' | 'none';
}) {
  if (direction === 'none') return <ArrowUpDown aria-hidden="true" />;
  return direction === 'ascending' ? (
    <ArrowUp aria-hidden="true" />
  ) : (
    <ArrowDown aria-hidden="true" />
  );
}

/**
 * Sorting and paging are links to the same address with other params, so the server reads the
 * order and the page and the table works with no script.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowId,
  path,
  query,
  sort,
  cursor,
  nextCursor,
  empty,
  error = null,
}: DataTableProps<Row>) {
  if (error) {
    return (
      <Alert
        tone="danger"
        title={error.title}
        body={error.body}
        action={<Link href={error.retryHref}>Try again</Link>}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>{empty.title}</p>
        {empty.body ? <p className={styles.emptyBody}>{empty.body}</p> : null}
        {cursor ? (
          <ButtonLink href={firstPageHref(path, query)} variant="secondary">
            Back to the first page
          </ButtonLink>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      {/* A table wider than the screen scrolls inside this box, which a keyboard reaches. */}
      <div
        className={styles.scroll}
        role="region"
        aria-label={caption}
        tabIndex={0}
      >
        <table className={styles.table}>
          <caption className={styles.caption}>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const direction = ariaSortFor(sort, column.id);
                return (
                  <th
                    key={column.id}
                    scope="col"
                    className={classNames(
                      styles.header,
                      alignClass[column.align ?? 'start'],
                    )}
                    aria-sort={column.sortable ? direction : undefined}
                  >
                    {column.sortable ? (
                      <Link
                        className={styles.sort}
                        href={sortHref(path, query, sort, column.id)}
                        prefetch={false}
                      >
                        {column.header}
                        <SortIcon direction={direction} />
                      </Link>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowId(row)} className={styles.row}>
                {columns.map((column) => {
                  const Cell = column.rowHeader ? 'th' : 'td';
                  return (
                    <Cell
                      key={column.id}
                      scope={column.rowHeader ? 'row' : undefined}
                      className={classNames(
                        styles.cell,
                        alignClass[column.align ?? 'start'],
                      )}
                    >
                      {column.cell(row)}
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor || nextCursor ? (
        <nav className={styles.pages} aria-label={`${caption} pages`}>
          {cursor ? (
            <ButtonLink href={firstPageHref(path, query)} variant="secondary">
              First page
            </ButtonLink>
          ) : null}
          {nextCursor ? (
            <ButtonLink
              href={nextPageHref(path, query, nextCursor)}
              variant="secondary"
            >
              Next page
            </ButtonLink>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
