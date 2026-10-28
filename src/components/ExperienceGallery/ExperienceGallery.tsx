import { ImageOff } from 'lucide-react';
import { Photo } from '@/components/Photo';
import type { PhotoView } from '@/lib/photoViews';
import styles from './ExperienceGallery.module.css';

export type ExperienceGalleryProps = {
  /** The experience's name, which names the gallery for a screen reader. */
  title: string;
  /** In gallery order; the first is the lead photo. */
  photos: readonly PhotoView[];
};

/** Photos the desktop grid shows before "See all": the lead and the two beside it. */
const gridPhotos = 3;

const leadSizes = '(min-width: 1200px) 792px, (min-width: 768px) 66vw, 100vw';
const sideSizes = '(min-width: 1200px) 384px, (min-width: 768px) 33vw, 100vw';
const moreSizes = '(min-width: 1200px) 384px, 33vw';

function Placeholder() {
  return (
    <div className={styles.placeholder}>
      <ImageOff className={styles.placeholderIcon} aria-hidden="true" />
      <p className={styles.placeholderText}>Photos are on their way</p>
    </div>
  );
}

/**
 * On a phone, the photos in a strip that scrolls sideways and snaps to each, the lead first. From
 * the tablet width, the lead beside two more, and the rest behind "See all". Every photo holds its
 * space before it loads, and only the lead is fetched ahead of the rest. It needs no script.
 */
export function ExperienceGallery({ title, photos }: ExperienceGalleryProps) {
  const count = photos.length;
  if (count === 0) {
    return (
      <div className={styles.gallery}>
        <Placeholder />
      </div>
    );
  }
  const extra = photos.slice(gridPhotos);

  return (
    <div className={styles.gallery}>
      {/* A scrolling region takes focus so a keyboard can scroll it. */}
      <div
        className={styles.strip}
        role="group"
        aria-label={`Photos of ${title}`}
        tabIndex={0}
      >
        <ul
          className={styles.list}
          data-count={count > gridPhotos ? 'many' : String(count)}
        >
          {photos.map((photo, index) => (
            <li key={photo.src} className={styles.item}>
              <Photo
                photo={photo}
                sizes={index === 0 ? leadSizes : sideSizes}
                preload={index === 0}
              />
              {count > 1 ? (
                <span className={styles.counter}>
                  {index + 1} of {count}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {extra.length > 0 ? (
        <details className={styles.more}>
          <summary className={styles.summary}>See all {count} photos</summary>
          <ul className={styles.moreList}>
            {extra.map((photo) => (
              <li key={photo.src} className={styles.moreItem}>
                <Photo photo={photo} sizes={moreSizes} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
