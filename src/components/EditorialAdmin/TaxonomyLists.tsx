import Link from 'next/link';
import { useId } from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { StatusBadge } from '@/components/StatusBadge';
import { classNames } from '@/lib/classNames';
import { commonCopy } from '@/lib/copy/common';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import {
  newTermPath,
  taxonomyPath,
  type TaxonomyRow,
} from '@/lib/editorialTaxonomy';
import type { FormAction } from '@/lib/opsForm';
import type { TaxonomyKind } from '@/lib/taxonomy';
import styles from './EditorialAdmin.module.css';

const copy = opsEditorialContentCopy.taxonomy;

export type TaxonomyListsProps = {
  categories: readonly TaxonomyRow[];
  neighborhoods: readonly TaxonomyRow[];
  /** Posts a click on a row's button: move, retire, bring back. */
  act: FormAction;
  /** Set when the read failed: the lists give way to a retry. */
  failed?: boolean;
};

/** The props that tie a disabled button to the sentence that says why, or none while it works. */
function describedBy(reason: string | null, id: string) {
  return reason === null ? {} : { 'aria-describedby': id };
}

function TaxonomySection({
  kind,
  rows,
  act,
}: {
  kind: TaxonomyKind;
  rows: readonly TaxonomyRow[];
  act: FormAction;
}) {
  const headingId = useId();
  const reasonPrefix = useId();
  const reasonId = (rowId: string, button: string) =>
    `${reasonPrefix}-${rowId}-${button}`;
  return (
    <section className={styles.stack} aria-labelledby={headingId}>
      <h2 id={headingId}>{copy.sections[kind]}</h2>
      <p>
        <ButtonLink href={newTermPath(kind)} variant="secondary">
          {copy.add.heading[kind]}
        </ButtonLink>
      </p>
      {rows.length === 0 ? (
        <div className={styles.stack}>
          <p>{copy.empty.title}</p>
          <p>{copy.empty.body}</p>
        </div>
      ) : (
        <form action={act}>
          <ol className={styles.rows} aria-label={copy.listLabels[kind]}>
            {rows.map((row) => (
              <li
                key={row.id}
                className={classNames(
                  styles.row,
                  row.retired ? styles.rowOff : undefined,
                )}
              >
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>
                    {row.name}
                    <StatusBadge tone={row.stateTone} label={row.stateLabel} />
                  </span>
                  <p className={styles.rowDetail}>{row.slug}</p>
                  {row.switchReason === null ? null : (
                    <p
                      className={styles.rowDetail}
                      id={reasonId(row.id, 'switch')}
                    >
                      {row.switchReason}
                    </p>
                  )}
                  {row.moveUpReason === null ? null : (
                    <span
                      className={styles.visuallyHidden}
                      id={reasonId(row.id, 'up')}
                    >
                      {row.moveUpReason}
                    </span>
                  )}
                  {row.moveDownReason === null ? null : (
                    <span
                      className={styles.visuallyHidden}
                      id={reasonId(row.id, 'down')}
                    >
                      {row.moveDownReason}
                    </span>
                  )}
                </div>
                <div className={styles.rowActions}>
                  <Button
                    type="submit"
                    name="op"
                    value={row.moveUpValue}
                    variant="secondary"
                    disabled={!row.canMoveUp}
                    {...describedBy(row.moveUpReason, reasonId(row.id, 'up'))}
                  >
                    {copy.actions.up}{' '}
                    <span className={styles.visuallyHidden}>{row.name}</span>
                  </Button>
                  <Button
                    type="submit"
                    name="op"
                    value={row.moveDownValue}
                    variant="secondary"
                    disabled={!row.canMoveDown}
                    {...describedBy(
                      row.moveDownReason,
                      reasonId(row.id, 'down'),
                    )}
                  >
                    {copy.actions.down}{' '}
                    <span className={styles.visuallyHidden}>{row.name}</span>
                  </Button>
                  <Button
                    type="submit"
                    name="op"
                    value={row.switchValue}
                    variant="secondary"
                    disabled={!row.canSwitch}
                    {...describedBy(
                      row.switchReason,
                      reasonId(row.id, 'switch'),
                    )}
                  >
                    {row.switchLabel}{' '}
                    <span className={styles.visuallyHidden}>{row.name}</span>
                  </Button>
                  <Link href={row.renameHref} className={styles.rowLink}>
                    {copy.actions.rename}{' '}
                    <span className={styles.visuallyHidden}>{row.name}</span>
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        </form>
      )}
    </section>
  );
}

/** The categories and the neighborhoods in the order guests see them, each row with the buttons that move it, retire it or bring it back, and a link to rename it. */
export function TaxonomyLists({
  categories,
  neighborhoods,
  act,
  failed = false,
}: TaxonomyListsProps) {
  if (failed) {
    return (
      <Alert
        tone="danger"
        title={copy.failed}
        action={<Link href={taxonomyPath}>{commonCopy.actions.tryAgain}</Link>}
      />
    );
  }
  return (
    <div className={styles.stack}>
      <TaxonomySection kind="category" rows={categories} act={act} />
      <TaxonomySection kind="neighborhood" rows={neighborhoods} act={act} />
    </div>
  );
}
