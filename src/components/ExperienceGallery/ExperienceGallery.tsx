import { ImageOff } from 'lucide-react';
import { Photo } from '@/components/Photo';
import type { GalleryView } from '@/lib/experiencePage';
import styles from './ExperienceGallery.module.css';

export type ExperienceGalleryProps = {
  /** The experience's name, which names the gallery for a screen reader. */
  title: string;
  /** How the photos are laid out and labelled, from `galleryView`. */
  gallery: GalleryView;
};

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
export function ExperienceGallery({ title, gallery }: ExperienceGalleryProps) {
  if (gallery.layout === 'none') {
    return (
      <div className={styles.gallery}>
        <Placeholder />
      </div>
    );
  }

  return (
    <div className={styles.gallery}>
      {/* A scrolling region takes focus so a keyboard can scroll it. */}
      <div
        className={styles.strip}
        role="group"
        aria-label={`Photos of ${title}`}
        tabIndex={0}
      >
        <ul className={styles.list} data-layout={gallery.layout}>
          {gallery.photos.map(({ photo, isLead, counter }) => (
            <li key={photo.src} className={styles.item}>
              <Photo
                photo={photo}
                sizes={isLead ? leadSizes : sideSizes}
                preload={isLead}
              />
              {counter ? (
                <span className={styles.counter}>{counter}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {gallery.seeAllLabel ? (
        <details className={styles.more}>
          <summary className={styles.summary}>{gallery.seeAllLabel}</summary>
          <ul className={styles.moreList}>
            {gallery.more.map((photo) => (
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
