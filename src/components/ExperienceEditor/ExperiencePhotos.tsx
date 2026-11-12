import { Button } from '@/components/Button';
import { CheckField } from '@/components/CheckField';
import { Input } from '@/components/Input';
import { Photo } from '@/components/Photo';
import { Select } from '@/components/Select';
import { errorProps } from '@/lib/opsForm';
import {
  photoAltSummary,
  photoProblemTexts,
  photoRightsBasisOptions,
  type PhotoFormField,
} from '@/lib/photoForm';
import {
  acceptedPhotoTypes,
  photoLimits,
  type GuestPhoto,
  type PhotoRefusalCode,
} from '@/lib/photos';
import { photoView } from '@/lib/photoViews';
import styles from './ExperienceEditor.module.css';

const thumbSizes = '(min-width: 768px) 12rem, 40vw';

export type ExperiencePhotosProps = {
  experienceId: string;
  /** The gallery in order; the first is the cover. */
  photos: readonly GuestPhoto[];
  /** The fields the last upload needed another look at, which the page read from the address. */
  problems?: readonly PhotoFormField[];
  /** Why the pipeline refused the last file, shown on the file field. */
  refusal?: PhotoRefusalCode | null;
  add: (formData: FormData) => void | Promise<void>;
};

/** The photos of an experience and the plain form that adds one: a file with its own alt text, or a decorative mark, and where the rights come from. */
export function ExperiencePhotos({
  experienceId,
  photos,
  problems = [],
  refusal = null,
  add,
}: ExperiencePhotosProps) {
  const texts = photoProblemTexts(refusal);
  const errorFor = (field: PhotoFormField) =>
    errorProps(problems, texts, field);
  return (
    <section className={styles.section} aria-labelledby="experience-photos">
      <h2 className={styles.heading} id="experience-photos">
        Photos
      </h2>
      <p className={styles.muted}>
        {photos.length} of {photoLimits.maxPerExperience}. The first photo is
        the cover guests see on the cards.
      </p>
      {photos.length === 0 ? (
        <p className={styles.muted}>This experience has no photos yet.</p>
      ) : (
        <ul className={styles.list}>
          {photos.map((photo) => (
            <li key={photo.id} className={styles.photoRow}>
              <div className={styles.thumb}>
                <Photo photo={photoView(photo)} sizes={thumbSizes} />
              </div>
              <p className={styles.photoText}>{photoAltSummary(photo)}</p>
            </li>
          ))}
        </ul>
      )}
      <form action={add} className={styles.form} noValidate>
        <input type="hidden" name="experienceId" value={experienceId} />
        <Input
          type="file"
          name="photoFile"
          label="Photo"
          hint="A JPEG, PNG or WebP photo."
          accept={acceptedPhotoTypes}
          required
          {...errorFor('photoFile')}
        />
        <Input
          name="altText"
          label="Alt text"
          hint="What the photo shows, for someone who cannot see it. Leave it empty only if the photo is decorative."
          maxLength={photoLimits.maxAltLength}
          autoComplete="off"
          {...errorFor('altText')}
        />
        <CheckField
          name="decorative"
          label="This photo is decorative and needs no alt text."
        />
        <Select
          name="rightsBasis"
          label="Rights"
          options={photoRightsBasisOptions}
          defaultValue="ramble_owned"
          required
          {...errorFor('rightsBasis')}
        />
        <Input
          name="rightsHolder"
          label="Photographer or rights holder"
          maxLength={photoLimits.maxRightsTextLength}
          autoComplete="off"
          optional
          {...errorFor('rightsHolder')}
        />
        <Input
          name="rightsLicense"
          label="Licence"
          hint="Required for a licensed photo."
          maxLength={photoLimits.maxRightsTextLength}
          autoComplete="off"
          optional
          {...errorFor('rightsLicense')}
        />
        <Input
          name="rightsSourceUrl"
          type="url"
          label="Source address"
          hint="Required for a licensed photo."
          maxLength={photoLimits.maxUrlLength}
          autoComplete="off"
          optional
          {...errorFor('rightsSourceUrl')}
        />
        <Button type="submit" size="lg">
          Add photo
        </Button>
      </form>
    </section>
  );
}
