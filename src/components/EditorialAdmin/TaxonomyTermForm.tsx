import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import {
  taxonomyFieldProblems,
  type TaxonomyFormField,
} from '@/lib/editorialTaxonomy';
import { errorProps, type FormAction } from '@/lib/opsForm';
import { taxonomyLimits, type TaxonomyKind } from '@/lib/taxonomy';
import styles from './EditorialAdmin.module.css';

const copy = opsEditorialContentCopy.taxonomy;

export type TaxonomyTermFormProps = {
  kind: TaxonomyKind;
  /** The term being renamed, or null for the form that adds one. */
  term: { id: string; name: string } | null;
  problems: readonly TaxonomyFormField[];
  save: FormAction;
};

/** The name, and for a new term its address. A renamed term keeps its address. */
export function TaxonomyTermForm({
  kind,
  term,
  problems,
  save,
}: TaxonomyTermFormProps) {
  return (
    <form action={save} className={styles.form}>
      <input type="hidden" name="kind" value={kind} />
      {term === null ? null : <input type="hidden" name="id" value={term.id} />}
      <Input
        name="name"
        label={term === null ? copy.add.name : copy.rename.name}
        {...(term === null ? {} : { hint: copy.rename.hint })}
        defaultValue={term?.name ?? ''}
        maxLength={taxonomyLimits.name}
        autoComplete="off"
        required
        {...errorProps(problems, taxonomyFieldProblems, 'name')}
      />
      {term === null ? (
        <Input
          name="slug"
          label={copy.add.slug}
          hint={copy.add.slugHint}
          maxLength={taxonomyLimits.slug}
          autoComplete="off"
          optional
          {...errorProps(problems, taxonomyFieldProblems, 'slug')}
        />
      ) : null}
      <div className={styles.actions}>
        <Button type="submit">
          {term === null ? copy.add.submit : copy.rename.submit}
        </Button>
      </div>
    </form>
  );
}
