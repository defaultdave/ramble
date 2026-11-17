'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { scrollRegionTabIndex, scrollsSideways } from '@/lib/scrollRegion';
import styles from './ExperienceGallery.module.css';

/**
 * The photo strip. A strip that scrolls takes a tab stop so a keyboard can scroll it, and is named
 * as a group. From the tablet width the photos lie in a grid and nothing scrolls, so the stop and
 * the group would be empty; this drops both while the strip fits. It starts as a scroller, which is
 * right on a phone from the first paint and with scripting off. A strip that stops scrolling while
 * it holds focus keeps a tabindex of -1 until it is left, so a keyboard keeps its place.
 */
export function GalleryStrip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(true);
  const [hasFocus, setHasFocus] = useState(false);

  useEffect(() => {
    const strip = ref.current;
    if (!strip) {
      return;
    }
    const measure = () => {
      setScrolls(scrollsSideways(strip));
      setHasFocus(document.activeElement === strip);
    };
    measure();
    // The strip keeps its own width when the layout switches, so the list inside is watched too.
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    if (strip.firstElementChild) {
      observer.observe(strip.firstElementChild);
    }
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      className={styles.strip}
      role={scrolls ? 'group' : undefined}
      aria-label={scrolls ? label : undefined}
      tabIndex={scrollRegionTabIndex(scrolls, hasFocus)}
      onBlur={() => {
        setHasFocus(false);
      }}
    >
      {children}
    </div>
  );
}
