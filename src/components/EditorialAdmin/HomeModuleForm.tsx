import { Button } from '@/components/Button';
import { CheckField } from '@/components/CheckField';
import { Input } from '@/components/Input';
import { RichTextEditor } from '@/components/RichTextEditor';
import { Select } from '@/components/Select';
import { opsEditorialSectionsCopy } from '@/lib/copy/opsEditorialSections';
import { editorialLimits, type HomeModule } from '@/lib/editorial';
import {
  homeFieldProblems,
  homeModuleFields,
  type HomeModuleField,
} from '@/lib/editorialHome';
import { errorProps } from '@/lib/opsForm';
import { emptyDoc } from '@/lib/richText/paragraphs';
import styles from './EditorialAdmin.module.css';

const copy = opsEditorialSectionsCopy.home;

type FormAction = (formData: FormData) => void | Promise<void>;

export type HomeModuleFormProps = {
  module: HomeModule;
  /** The module's place in the list, which the save names the module by. */
  position: number;
  picks: readonly { value: string; label: string }[];
  problems: readonly HomeModuleField[];
  save: FormAction;
};

/** The settings the guest page reads for this kind of module, and whether it shows. Only the body editor needs script. */
export function HomeModuleForm({
  module,
  position,
  picks,
  problems,
  save,
}: HomeModuleFormProps) {
  const shown = homeModuleFields(module.kind);
  return (
    <form action={save} className={styles.form}>
      <input type="hidden" name="position" value={position} />
      <input type="hidden" name="kind" value={module.kind} />
      <CheckField
        name="enabled"
        label={copy.fields.enabled}
        defaultChecked={module.enabled}
      />
      {shown.includes('heading') ? (
        <Input
          name="heading"
          label={copy.fields.heading}
          hint={copy.fields.headingHint}
          defaultValue={module.heading ?? ''}
          maxLength={editorialLimits.heading}
          autoComplete="off"
          optional
          {...errorProps(problems, homeFieldProblems, 'heading')}
        />
      ) : null}
      {shown.includes('collectionId') ? (
        <Select
          name="collectionId"
          label={copy.fields.collection}
          options={picks}
          placeholder={copy.fields.collectionPlaceholder}
          defaultValue={module.collectionId ?? ''}
          optional
          {...errorProps(problems, homeFieldProblems, 'collectionId')}
        />
      ) : null}
      {shown.includes('body') ? (
        <RichTextEditor
          name="body"
          label={copy.fields.body}
          initial={module.body ?? emptyDoc}
          {...errorProps(problems, homeFieldProblems, 'body')}
        />
      ) : null}
      <div className={styles.actions}>
        <Button type="submit">{copy.actions.save}</Button>
      </div>
    </form>
  );
}
