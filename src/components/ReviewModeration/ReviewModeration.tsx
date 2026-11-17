import { Button } from '@/components/Button';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { Select } from '@/components/Select';
import { StatusBadge, StatusFilterBar } from '@/components/StatusBadge';
import { reviewModerationCopy as copy } from '@/lib/copy/reviewModeration';
import {
  reviewHideReasonOptions,
  reviewModerationPath,
  reviewStatusOptions,
  reviewStatusTones,
  type ReviewModerationRow,
} from '@/lib/reviewModeration';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './ReviewModeration.module.css';

type FormAction = (formData: FormData) => void | Promise<void>;

export type ReviewModerationProps = {
  rows: readonly ReviewModerationRow[];
  query: TableQuery;
  cursor: string | null;
  nextCursor: string | null;
  hide: FormAction;
  unhide: FormAction;
};

/** Newest reviews first, filtered by status. Filters and pages are links and the hide and show forms are plain forms, so it all works with no script. */
export function ReviewModeration({
  rows,
  query,
  cursor,
  nextCursor,
  hide,
  unhide,
}: ReviewModerationProps) {
  const columns: DataTableColumn<ReviewModerationRow>[] = [
    {
      id: 'written',
      header: copy.columns.written,
      rowHeader: true,
      cell: (row) => row.writtenLabel,
    },
    {
      id: 'experience',
      header: copy.columns.experience,
      cell: (row) => row.experienceName,
    },
    {
      id: 'rating',
      header: copy.columns.rating,
      cell: (row) => row.ratingText,
    },
    {
      id: 'review',
      header: copy.columns.review,
      cell: (row) => <span className={styles.body}>{row.body}</span>,
    },
    { id: 'from', header: copy.columns.from, cell: (row) => row.firstName },
    {
      id: 'status',
      header: copy.columns.status,
      cell: (row) => (
        <StatusBadge
          tone={reviewStatusTones[row.status]}
          label={copy.statusLabels[row.status]}
        />
      ),
    },
    {
      id: 'action',
      header: copy.columns.action,
      cell: (row) =>
        row.status === 'visible' ? (
          <form action={hide} className={styles.actionForm}>
            <input type="hidden" name="id" value={row.id} />
            <Select
              name="reason"
              label={copy.hideReasonLabel(row.firstName)}
              options={reviewHideReasonOptions}
              placeholder={copy.hideReasonPlaceholder}
              required
            />
            <Button type="submit" variant="secondary">
              {copy.hide}
            </Button>
          </form>
        ) : (
          <form action={unhide} className={styles.actionForm}>
            <input type="hidden" name="id" value={row.id} />
            <Button type="submit" variant="secondary">
              {copy.unhide}
            </Button>
          </form>
        ),
    },
  ];

  return (
    <div className={styles.stack}>
      <StatusFilterBar
        path={reviewModerationPath}
        query={query}
        options={reviewStatusOptions}
        label={copy.filterLabel}
      />
      <DataTable
        caption={copy.caption}
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        path={reviewModerationPath}
        query={query}
        sort={{ column: 'written', direction: 'desc' }}
        cursor={cursor}
        nextCursor={nextCursor}
        empty={copy.empty}
      />
    </div>
  );
}
