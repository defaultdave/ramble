import { useId } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { opsEditorialSectionsCopy } from '@/lib/copy/opsEditorialSections';
import { editorialLimits } from '@/lib/editorial';
import {
  itemFieldProblems,
  type ItemFormField,
  type ItemRow,
} from '@/lib/editorialCollections';
import { errorProps, type FormAction } from '@/lib/opsForm';
import styles from './EditorialAdmin.module.css';

const copy = opsEditorialSectionsCopy.collections.items;

export type CollectionItemsProps = {
  collectionId: string;
  rows: readonly ItemRow[];
  /** The experiences not yet in the list. */
  options: readonly { value: string; label: string }[];
  problems: readonly ItemFormField[];
  /** Posts a click on the list or the add form. */
  act: FormAction;
};

/**
 * The Pick's experiences in the order guests see them, with the buttons that move or remove each,
 * and the form that adds one. The list and the add form are two forms, so Enter in the note adds
 * and never moves the first row.
 */
export function CollectionItems({
  collectionId,
  rows,
  options,
  problems,
  act,
}: CollectionItemsProps) {
  const headingId = useId();
  return (
    <section className={styles.stack} aria-labelledby={headingId}>
      <h2 id={headingId}>{copy.heading}</h2>
      {rows.length === 0 ? (
        <p>{copy.empty}</p>
      ) : (
        <form action={act}>
          <input type="hidden" name="id" value={collectionId} />
          <ol className={styles.rows} aria-label={copy.listLabel}>
            {rows.map((row) => (
              <li key={row.experienceId} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>{row.name}</span>
                  {row.note ? (
                    <p className={styles.rowDetail}>{row.note}</p>
                  ) : null}
                </div>
                <div className={styles.rowActions}>
                  <Button
                    type="submit"
                    name="op"
                    value={row.upValue}
                    variant="secondary"
                    disabled={!row.canMoveUp}
                  >
                    {copy.actions.up}{' '}
                    <span className={styles.visuallyHidden}>{row.name}</span>
                  </Button>
                  <Button
                    type="submit"
                    name="op"
                    value={row.downValue}
                    variant="secondary"
                    disabled={!row.canMoveDown}
                  >
                    {copy.actions.down}{' '}
                    <span className={styles.visuallyHidden}>{row.name}</span>
                  </Button>
                  <Button
                    type="submit"
                    name="op"
                    value={row.removeValue}
                    variant="secondary"
                  >
                    {copy.actions.remove}{' '}
                    <span className={styles.visuallyHidden}>{row.name}</span>
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </form>
      )}
      {options.length === 0 ? (
        <Alert tone="info" title={copy.none} />
      ) : (
        <form action={act} className={styles.form}>
          <input type="hidden" name="id" value={collectionId} />
          <Select
            name="experienceId"
            label={copy.add.experience}
            options={options}
            placeholder={copy.add.experiencePlaceholder}
            required
            {...errorProps(problems, itemFieldProblems, 'experienceId')}
          />
          <Input
            name="note"
            label={copy.add.note}
            hint={copy.add.noteHint}
            maxLength={editorialLimits.note}
            autoComplete="off"
            optional
            {...errorProps(problems, itemFieldProblems, 'note')}
          />
          <div className={styles.actions}>
            <Button type="submit" name="op" value="add">
              {copy.add.submit}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
