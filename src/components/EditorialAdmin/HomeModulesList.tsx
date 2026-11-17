import Link from 'next/link';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/StatusBadge';
import { commonCopy } from '@/lib/copy/common';
import { opsEditorialSectionsCopy } from '@/lib/copy/opsEditorialSections';
import {
  homeModulePath,
  homePath,
  type HomeModuleRow,
} from '@/lib/editorialHome';
import { classNames } from '@/lib/classNames';
import type { FormAction } from '@/lib/opsForm';
import styles from './EditorialAdmin.module.css';

const copy = opsEditorialSectionsCopy.home;

export type HomeModulesListProps = {
  rows: readonly HomeModuleRow[];
  /** Posts a click on a row's button: move, turn on, turn off. */
  act: FormAction;
  /** Set when the read failed: the list gives way to a retry. */
  failed?: boolean;
};

/** The home page modules in the order guests see them, each with the buttons that move it, switch it, and open its editor. */
export function HomeModulesList({
  rows,
  act,
  failed = false,
}: HomeModulesListProps) {
  if (failed) {
    return (
      <Alert
        tone="danger"
        title={copy.failed}
        action={<Link href={homePath}>{commonCopy.actions.tryAgain}</Link>}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <div className={styles.stack}>
        <p>{copy.empty.title}</p>
        <p>{copy.empty.body}</p>
      </div>
    );
  }
  return (
    <form action={act}>
      <ol className={styles.rows} aria-label={copy.listLabel}>
        {rows.map((row) => (
          <li
            key={row.position}
            className={classNames(
              styles.row,
              row.enabled ? undefined : styles.rowOff,
            )}
          >
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>
                {row.label}
                <StatusBadge tone={row.stateTone} label={row.stateLabel} />
              </span>
              <p className={styles.rowDetail}>{row.detail}</p>
            </div>
            <div className={styles.rowActions}>
              <Button
                type="submit"
                name="op"
                value={row.moveUpValue}
                variant="secondary"
                disabled={!row.canMoveUp}
              >
                {copy.actions.up}{' '}
                <span className={styles.visuallyHidden}>{row.label}</span>
              </Button>
              <Button
                type="submit"
                name="op"
                value={row.moveDownValue}
                variant="secondary"
                disabled={!row.canMoveDown}
              >
                {copy.actions.down}{' '}
                <span className={styles.visuallyHidden}>{row.label}</span>
              </Button>
              {row.canSwitch ? (
                <Button
                  type="submit"
                  name="op"
                  value={row.switchValue}
                  variant="secondary"
                >
                  {row.switchLabel}{' '}
                  <span className={styles.visuallyHidden}>{row.label}</span>
                </Button>
              ) : null}
              {row.editable ? (
                <Link
                  href={homeModulePath(row.position)}
                  className={styles.rowLink}
                >
                  {copy.actions.edit}{' '}
                  <span className={styles.visuallyHidden}>{row.label}</span>
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </form>
  );
}
