'use client';

import Image from 'next/image';
import { useState, type SyntheticEvent } from 'react';
import type { PhotoView } from '@/lib/photoViews';
import { classNames } from '@/lib/classNames';
import styles from './Photo.module.css';

export type PhotoWithUnderlayProps = {
  photo: PhotoView;
  sizes: string;
  underlaySizes: string;
  preload: boolean;
};

/**
 * The photo drawn twice. The lower layer asks for the width another view of the same photo asked
 * for (a card's), so the browser has it already and paints it at once; it also carries the blur
 * for a visit with nothing cached. The upper layer is the width this view needs, and fades in once
 * it has loaded.
 */
export function PhotoWithUnderlay({
  photo,
  sizes,
  underlaySizes,
  preload,
}: PhotoWithUnderlayProps) {
  const [loaded, setLoaded] = useState(false);

  // An image from cache can finish before the page is interactive, and then no load event comes.
  const markIfComplete = (image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth > 0) {
      setLoaded(true);
    }
  };

  return (
    <>
      <Image
        className={styles.photo}
        src={photo.src}
        alt=""
        fill
        sizes={underlaySizes}
        loading="eager"
        placeholder="blur"
        blurDataURL={photo.blurDataUrl}
      />
      <Image
        ref={markIfComplete}
        className={classNames(styles.photo, styles.main)}
        src={photo.src}
        alt={photo.alt}
        fill
        sizes={sizes}
        preload={preload}
        fetchPriority={preload ? 'high' : undefined}
        data-loaded={loaded}
        onLoad={(event: SyntheticEvent<HTMLImageElement>) => {
          markIfComplete(event.currentTarget);
        }}
      />
    </>
  );
}
