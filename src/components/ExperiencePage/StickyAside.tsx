'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { stickyTop } from '@/lib/stickyPanel';
import styles from './ExperiencePage.module.css';

/**
 * The booking panel's column from the tablet width. The stylesheet makes it sticky at the top, which
 * is all a panel that fits the window needs and what shows without JavaScript. A panel taller than the
 * window would show its end only when its row ended, so this moves where it sticks as the page scrolls:
 * it follows the scroll until its bottom edge reaches the window's bottom, and back until its top edge
 * reaches the top.
 */
export function StickyAside({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const aside = ref.current;
    if (!aside) {
      return;
    }
    const wide = window.matchMedia('(min-width: 768px)');
    // The heights are read when they change, so a scroll frame only writes.
    let offset = 0;
    let panelHeight = 0;
    let viewportHeight = 0;
    let top = 0;
    let lastScrollY = window.scrollY;
    let frame = 0;

    const place = (scrollDelta: number) => {
      top = stickyTop({
        previousTop: top,
        scrollDelta,
        viewportHeight,
        panelHeight,
        offset,
      });
      aside.style.insetBlockStart = `${String(top)}px`;
    };
    const readOffset = () =>
      Number.parseFloat(
        getComputedStyle(aside).getPropertyValue('--panel-offset'),
      );
    const measure = () => {
      offset = readOffset();
      panelHeight = aside.offsetHeight;
      viewportHeight = window.innerHeight;
      place(0);
    };
    const onScroll = () => {
      if (frame !== 0) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        const { scrollY } = window;
        const scrollDelta = scrollY - lastScrollY;
        lastScrollY = scrollY;
        place(scrollDelta);
      });
    };
    let observer: ResizeObserver | undefined;

    const start = () => {
      aside.style.insetBlockStart = '';
      top = readOffset();
      lastScrollY = window.scrollY;
      measure();
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', measure);
      observer = new ResizeObserver(() => {
        panelHeight = aside.offsetHeight;
        place(0);
      });
      observer.observe(aside);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
      aside.style.insetBlockStart = '';
    };
    const onWidth = () => {
      stop();
      if (wide.matches) {
        start();
      }
    };

    onWidth();
    wide.addEventListener('change', onWidth);
    return () => {
      wide.removeEventListener('change', onWidth);
      stop();
    };
  }, []);
  return (
    <aside ref={ref} className={styles.aside}>
      {children}
    </aside>
  );
}
