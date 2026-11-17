import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { RichTextEditor } from '@/components/RichTextEditor';
import { Textarea } from '@/components/Textarea';
import { opsEditorialSectionsCopy } from '@/lib/copy/opsEditorialSections';
import { editorialLimits, type Collection } from '@/lib/editorial';
import { saveLabel, toggleIntent, toggleLabel } from '@/lib/editorialAdmin';
import {
  collectionFieldProblems,
  type CollectionFormField,
} from '@/lib/editorialCollections';
import { errorProps, type FormAction } from '@/lib/opsForm';
import { emptyDoc } from '@/lib/richText/paragraphs';
import styles from './EditorialAdmin.module.css';

const copy = opsEditorialSectionsCopy.collections;

export type CollectionFormProps = {
  /** The Pick being edited, or null for a new one. */
  collection: Collection | null;
  problems: readonly CollectionFormField[];
  save: FormAction;
};

/**
 * Title, address, summary and introduction, with the buttons that save a draft, publish, or take
 * the Pick down. A new Pick can only be saved as a draft: it has no experiences to publish yet.
 * The form posts to the action; only the introduction editor needs script.
 */
export function CollectionForm({
  collection,
  problems,
  save,
}: CollectionFormProps) {
  return (
    <form action={save} className={styles.form}>
      {collection ? (
        <>
          <input type="hidden" name="id" value={collection.id} />
          <input type="hidden" name="currentSlug" value={collection.slug} />
        </>
      ) : null}
      <Input
        name="title"
        label={copy.fields.title}
        defaultValue={collection?.title ?? ''}
        maxLength={editorialLimits.title}
        autoComplete="off"
        required
        {...errorProps(problems, collectionFieldProblems, 'title')}
      />
      <Input
        name="slug"
        label={copy.fields.slug}
        hint={copy.fields.slugHint}
        defaultValue={collection?.slug ?? ''}
        maxLength={editorialLimits.slug}
        autoComplete="off"
        optional
        {...errorProps(problems, collectionFieldProblems, 'slug')}
      />
      <Textarea
        name="summary"
        label={copy.fields.summary}
        defaultValue={collection?.summary ?? ''}
        maxLength={editorialLimits.summary}
        rows={3}
        optional
        {...errorProps(problems, collectionFieldProblems, 'summary')}
      />
      <RichTextEditor
        name="intro"
        label={copy.fields.intro}
        initial={collection?.intro ?? emptyDoc}
        {...errorProps(problems, collectionFieldProblems, 'intro')}
      />
      <div className={styles.actions}>
        <Button type="submit" name="intent" value="save">
          {saveLabel(collection?.status)}
        </Button>
        {collection ? (
          <Button
            type="submit"
            name="intent"
            value={toggleIntent(collection.status)}
            variant="secondary"
          >
            {toggleLabel(collection.status)}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
