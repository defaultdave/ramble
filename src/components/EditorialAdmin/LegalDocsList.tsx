import Link from 'next/link';
import { Alert } from '@/components/Alert';
import { commonCopy } from '@/lib/copy/common';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import { legalAdminPath, type LegalDocRow } from '@/lib/editorialLegal';
import styles from './EditorialAdmin.module.css';

const copy = opsEditorialContentCopy.legal;

export type LegalDocsListProps = {
  rows: readonly LegalDocRow[];
  /** Set when the read failed: the list gives way to a retry. */
  failed?: boolean;
};

/** Every legal document, with what is live and what is waiting, each opening its versions. */
export function LegalDocsList({ rows, failed = false }: LegalDocsListProps) {
  if (failed) {
    return (
      <Alert
        tone="danger"
        title={copy.failed}
        action={
          <Link href={legalAdminPath}>{commonCopy.actions.tryAgain}</Link>
        }
      />
    );
  }
  return (
    <ul className={styles.rows} aria-label={copy.listLabel}>
      {rows.map((row) => (
        <li key={row.doc} className={styles.row}>
          <div className={styles.rowMain}>
            <span className={styles.rowTitle}>
              <Link href={row.href}>{row.label}</Link>
            </span>
            <p className={styles.rowDetail}>{row.state}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
