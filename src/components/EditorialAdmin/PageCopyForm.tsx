import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { RichTextEditor } from '@/components/RichTextEditor';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import { editorialLimits, type PageCopy } from '@/lib/editorial';
import {
  saveLabel,
  toggleIntent,
  toggleLabel,
  type PublishStatus,
} from '@/lib/editorialAdmin';
import {
  pageFieldProblems,
  type PageFormField,
  type PageKind,
} from '@/lib/editorialPages';
import { errorProps, type FormAction } from '@/lib/opsForm';
import { emptyDoc } from '@/lib/richText/paragraphs';
import styles from './EditorialAdmin.module.css';

const copy = opsEditorialContentCopy.pages.fields;

export type PageCopyFormProps = {
  kind: PageKind;
  /** The category or neighborhood the copy belongs to. */
  targetId: string;
  /** The copy the page has, or null before its first save. */
  page: PageCopy | null;
  problems: readonly PageFormField[];
  save: FormAction;
};

/** Heading, search description, introduction and text, with the buttons that save a draft, publish, or take the copy down. Only the two text editors need script. */
export function PageCopyForm({
  kind,
  targetId,
  page,
  problems,
  save,
}: PageCopyFormProps) {
  const status: PublishStatus | undefined = page?.status;
  return (
    <form action={save} className={styles.form}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="targetId" value={targetId} />
      <input type="hidden" name="status" value={status ?? 'draft'} />
      <Input
        name="heading"
        label={copy.heading}
        hint={copy.headingHint}
        defaultValue={page?.heading ?? ''}
        maxLength={editorialLimits.heading}
        autoComplete="off"
        optional
        {...errorProps(problems, pageFieldProblems, 'heading')}
      />
      <Input
        name="metaDescription"
        label={copy.metaDescription}
        hint={copy.metaDescriptionHint}
        defaultValue={page?.metaDescription ?? ''}
        maxLength={editorialLimits.metaDescription}
        autoComplete="off"
        optional
        {...errorProps(problems, pageFieldProblems, 'metaDescription')}
      />
      <RichTextEditor
        name="intro"
        label={copy.intro}
        initial={page?.intro ?? emptyDoc}
        {...errorProps(problems, pageFieldProblems, 'intro')}
      />
      <RichTextEditor
        name="body"
        label={copy.body}
        initial={page?.body ?? emptyDoc}
        {...errorProps(problems, pageFieldProblems, 'body')}
      />
      <div className={styles.actions}>
        <Button type="submit" name="intent" value="save">
          {saveLabel(status)}
        </Button>
        <Button
          type="submit"
          name="intent"
          value={toggleIntent(status)}
          variant="secondary"
        >
          {toggleLabel(status)}
        </Button>
      </div>
    </form>
  );
}
