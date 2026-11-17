import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { RichTextEditor } from '@/components/RichTextEditor';
import { Textarea } from '@/components/Textarea';
import { editorialLimits, type HelpArticle } from '@/lib/editorial';
import {
  entryFieldProblems,
  saveLabel,
  toggleIntent,
  toggleLabel,
  type EntryFormField,
} from '@/lib/editorialAdmin';
import { errorProps } from '@/lib/opsForm';
import type { RichTextDoc } from '@/lib/richText/format';
import styles from './EditorialAdmin.module.css';

type FormAction = (formData: FormData) => void | Promise<void>;

export type EntryFormProps = {
  /** The article being edited, or null for a new one. */
  entry: HelpArticle | null;
  problems: readonly EntryFormField[];
  save: FormAction;
};

const emptyBody: RichTextDoc = { type: 'doc', content: [] };

/**
 * Title, address, summary and body, with the buttons that save a draft, publish, or take the
 * article down. The form posts to the action; only the body editor needs script.
 */
export function EntryForm({ entry, problems, save }: EntryFormProps) {
  const intent = toggleIntent(entry?.status);
  return (
    <form action={save} className={styles.form}>
      {entry ? <input type="hidden" name="id" value={entry.id} /> : null}
      <input type="hidden" name="status" value={entry?.status ?? 'draft'} />
      <input type="hidden" name="position" value={entry?.position ?? 0} />
      {entry ? (
        <input type="hidden" name="currentSlug" value={entry.slug} />
      ) : null}
      <Input
        name="title"
        label="Title"
        defaultValue={entry?.title ?? ''}
        maxLength={editorialLimits.title}
        autoComplete="off"
        required
        {...errorProps(problems, entryFieldProblems, 'title')}
      />
      <Input
        name="slug"
        label="Address"
        hint="The last part of the page address. Leave it blank to keep the current one, or to make it from the title for a new article."
        defaultValue={entry?.slug ?? ''}
        maxLength={editorialLimits.slug}
        autoComplete="off"
        optional
        {...errorProps(problems, entryFieldProblems, 'slug')}
      />
      <Textarea
        name="summary"
        label="Summary"
        defaultValue={entry?.summary ?? ''}
        maxLength={editorialLimits.summary}
        rows={3}
        optional
        {...errorProps(problems, entryFieldProblems, 'summary')}
      />
      <RichTextEditor
        name="body"
        label="Body"
        initial={entry?.body ?? emptyBody}
        {...errorProps(problems, entryFieldProblems, 'body')}
      />
      <div className={styles.actions}>
        <Button type="submit" name="intent" value="save">
          {saveLabel(entry?.status)}
        </Button>
        <Button type="submit" name="intent" value={intent} variant="secondary">
          {toggleLabel(entry?.status)}
        </Button>
      </div>
    </form>
  );
}
