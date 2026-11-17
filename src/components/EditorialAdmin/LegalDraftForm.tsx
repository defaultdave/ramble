import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { RichTextEditor } from '@/components/RichTextEditor';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import { editorialLimits } from '@/lib/editorial';
import { legalFieldProblems, type LegalFormField } from '@/lib/editorialLegal';
import { errorProps, type FormAction } from '@/lib/opsForm';
import type { RichTextDoc } from '@/lib/richText/format';
import { emptyDoc } from '@/lib/richText/paragraphs';
import styles from './EditorialAdmin.module.css';

const copy = opsEditorialContentCopy.legal;

export type LegalDraftFormProps = {
  doc: string;
  /** The draft being edited, or null for the form that starts the next version. */
  draftId: string | null;
  title: string;
  body: RichTextDoc | null;
  problems: readonly LegalFormField[];
  save: FormAction;
};

/**
 * The title and text of a version. A draft being edited can be saved or published; the form that
 * starts the next version has one button and begins from the newest version's words. Only the
 * text editor needs script.
 */
export function LegalDraftForm({
  doc,
  draftId,
  title,
  body,
  problems,
  save,
}: LegalDraftFormProps) {
  return (
    <form action={save} className={styles.form}>
      <input type="hidden" name="doc" value={doc} />
      {draftId === null ? null : (
        <input type="hidden" name="id" value={draftId} />
      )}
      <Input
        name="title"
        label={copy.fields.title}
        defaultValue={title}
        maxLength={editorialLimits.title}
        autoComplete="off"
        required
        {...errorProps(problems, legalFieldProblems, 'title')}
      />
      <RichTextEditor
        name="body"
        label={copy.fields.body}
        initial={body ?? emptyDoc}
        {...errorProps(problems, legalFieldProblems, 'body')}
      />
      <div className={styles.actions}>
        <Button type="submit" name="intent" value="save">
          {draftId === null ? copy.newDraft.submit : copy.actions.save}
        </Button>
        {draftId === null ? null : (
          <Button
            type="submit"
            name="intent"
            value="publish"
            variant="secondary"
          >
            {copy.actions.publish}
          </Button>
        )}
      </div>
      {draftId === null ? null : <p>{copy.publishHint}</p>}
    </form>
  );
}
