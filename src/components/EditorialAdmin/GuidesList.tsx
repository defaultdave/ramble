import { DataTable } from '@/components/DataTable';
import { experienceColumns } from '@/components/ExperienceEditor';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import { guidePath, guidesPath } from '@/lib/editorialGuides';
import type { ExperienceListRow } from '@/lib/experienceEditor';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './EditorialAdmin.module.css';

const copy = opsEditorialContentCopy.guides;

export type GuidesListProps = {
  rows: readonly ExperienceListRow[];
  query: TableQuery;
  cursor: string | null;
  nextCursor: string | null;
  /** Set when the read failed: the table gives way to a retry. */
  failed?: boolean;
};

const columns = experienceColumns(guidePath, false);

/** The guide-only entries by name, each opening the form for its links. */
export function GuidesList({
  rows,
  query,
  cursor,
  nextCursor,
  failed = false,
}: GuidesListProps) {
  return (
    <div className={styles.stack}>
      <DataTable
        caption={copy.caption}
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        path={guidesPath}
        query={query}
        sort={{ column: 'name', direction: 'asc' }}
        cursor={cursor}
        nextCursor={nextCursor}
        empty={copy.empty}
        error={failed ? { title: copy.failed, retryHref: guidesPath } : null}
      />
    </div>
  );
}
