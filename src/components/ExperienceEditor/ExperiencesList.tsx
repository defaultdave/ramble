import Link from 'next/link';
import { Button } from '@/components/Button';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { Select } from '@/components/Select';
import { StatusBadge, StatusFilterBar } from '@/components/StatusBadge';
import {
  experiencePath,
  experiencesPath,
  experienceStatusLabels,
  experienceStatusOptions,
  experienceStatusTones,
  type Choice,
  type ExperienceFilters,
  type ExperienceListRow,
} from '@/lib/experienceEditor';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './ExperienceEditor.module.css';

const columns: DataTableColumn<ExperienceListRow>[] = [
  {
    id: 'name',
    header: 'Experience',
    rowHeader: true,
    cell: (row) => (
      <Link className={styles.cellLink} href={experiencePath(row.id)}>
        {row.name}
      </Link>
    ),
  },
  { id: 'host', header: 'Host', cell: (row) => row.hostName },
  { id: 'category', header: 'Category', cell: (row) => row.categoryName },
  {
    id: 'status',
    header: 'Status',
    cell: (row) => (
      <StatusBadge
        tone={experienceStatusTones[row.status]}
        label={experienceStatusLabels[row.status]}
      />
    ),
  },
];

export type ExperiencesListProps = {
  rows: readonly ExperienceListRow[];
  query: TableQuery;
  filters: ExperienceFilters;
  hosts: readonly Choice[];
  categories: readonly Choice[];
  cursor: string | null;
  nextCursor: string | null;
};

/**
 * The experiences by name, filtered by status, host and category. Every filter and page is an
 * address, so the list works with no script and a filtered view can be shared.
 */
export function ExperiencesList({
  rows,
  query,
  filters,
  hosts,
  categories,
  cursor,
  nextCursor,
}: ExperiencesListProps) {
  return (
    <div className={styles.stack}>
      <StatusFilterBar
        path={experiencesPath}
        query={query}
        options={experienceStatusOptions}
        label="Filter experiences by status"
      />
      <form method="get" action={experiencesPath} className={styles.filters}>
        {filters.status ? (
          <input type="hidden" name="status" value={filters.status} />
        ) : null}
        <div className={styles.pair}>
          <Select
            name="host"
            label="Host"
            placeholder="All hosts"
            options={hosts}
            defaultValue={filters.hostId ?? ''}
          />
          <Select
            name="category"
            label="Category"
            placeholder="All categories"
            options={categories}
            defaultValue={filters.categoryId ?? ''}
          />
        </div>
        <Button type="submit" variant="secondary">
          Apply filters
        </Button>
      </form>
      <DataTable
        caption="Experiences"
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        path={experiencesPath}
        query={query}
        sort={{ column: 'name', direction: 'asc' }}
        cursor={cursor}
        nextCursor={nextCursor}
        empty={{
          title: 'No experiences match',
          body: 'Change the filters, or add an experience for a host.',
        }}
      />
    </div>
  );
}
