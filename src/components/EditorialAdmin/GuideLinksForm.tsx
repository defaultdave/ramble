import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import type { GuideFormField } from '@/lib/editorialGuides';
import {
  experienceFieldProblems,
  experienceLimits,
} from '@/lib/experienceEditor';
import { errorProps, type FormAction } from '@/lib/opsForm';
import styles from './EditorialAdmin.module.css';

const copy = opsEditorialContentCopy.guides;

export type GuideLinksFormProps = {
  experienceId: string;
  linkOutUrl: string | null;
  affiliateUrl: string | null;
  problems: readonly GuideFormField[];
  save: FormAction;
};

/** The two addresses a guide-only entry sends guests to. The link-out is required, as it is on the experience form. */
export function GuideLinksForm({
  experienceId,
  linkOutUrl,
  affiliateUrl,
  problems,
  save,
}: GuideLinksFormProps) {
  return (
    <form action={save} className={styles.form}>
      <input type="hidden" name="id" value={experienceId} />
      <Input
        name="linkOutUrl"
        type="url"
        label={copy.fields.linkOutUrl}
        hint={copy.fields.linkOutUrlHint}
        defaultValue={linkOutUrl ?? undefined}
        maxLength={experienceLimits.url}
        autoComplete="off"
        required
        {...errorProps(problems, experienceFieldProblems, 'linkOutUrl')}
      />
      <Input
        name="affiliateUrl"
        type="url"
        label={copy.fields.affiliateUrl}
        hint={copy.fields.affiliateUrlHint}
        defaultValue={affiliateUrl ?? undefined}
        maxLength={experienceLimits.url}
        autoComplete="off"
        optional
        {...errorProps(problems, experienceFieldProblems, 'affiliateUrl')}
      />
      <div className={styles.actions}>
        <Button type="submit">{copy.fields.save}</Button>
      </div>
    </form>
  );
}
