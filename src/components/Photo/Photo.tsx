import Image from 'next/image';
import type { PhotoView } from '@/lib/photoViews';
import styles from './Photo.module.css';
import { PhotoWithUnderlay } from './PhotoWithUnderlay';

export type PhotoProps = {
  photo: PhotoView;
  /** What the browser needs to pick a size before layout: the width this photo takes at each breakpoint. */
  sizes: string;
  /**
   * For the one photo that is the page's largest paint: it is drawn eagerly and fetched at high
   * priority, and the preload hint carries the same priority so the fetch can start before layout.
   */
  preload?: boolean;
  /**
   * The `sizes` of another view that draws this same photo, usually the card that led here. The
   * photo is drawn again beneath, asking for the width that view asked for, so it comes from cache
   * and shows at once while the full photo loads and fades in over it.
   */
  underlaySizes?: string | undefined;
};

/**
 * A guest photo that fills the frame it is placed in, which holds the aspect ratio so nothing
 * moves when it loads. It shows its blur placeholder until it arrives.
 */
export function Photo({
  photo,
  sizes,
  preload = false,
  underlaySizes,
}: PhotoProps) {
  if (underlaySizes) {
    return (
      <PhotoWithUnderlay
        photo={photo}
        sizes={sizes}
        underlaySizes={underlaySizes}
        preload={preload}
      />
    );
  }

  return (
    <Image
      className={styles.photo}
      src={photo.src}
      alt={photo.alt}
      fill
      sizes={sizes}
      preload={preload}
      fetchPriority={preload ? 'high' : undefined}
      placeholder="blur"
      blurDataURL={photo.blurDataUrl}
    />
  );
}
