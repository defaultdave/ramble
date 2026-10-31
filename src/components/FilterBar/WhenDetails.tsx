'use client';

import { useEffect, useRef, type ReactNode } from 'react';

type WhenDetailsProps = {
  className?: string | undefined;
  summaryClassName?: string | undefined;
  /** What the date chip says. */
  summary: ReactNode;
  /** The chosen day. When it changes, the calendar closes and focus goes back to the chip. */
  date: string | null;
  children: ReactNode;
};

/**
 * The calendar disclosure. The browser opens and closes it, so the chip needs no script to work.
 * It stays mounted when a day is picked (a new key would drop focus to the page), so this closes it
 * and puts focus back on the chip, where a keyboard user was. Escape closes it too, and so does a
 * press anywhere outside it, because the calendar can float over the page.
 */
export function WhenDetails({
  className,
  summaryClassName,
  summary,
  date,
  children,
}: WhenDetailsProps) {
  const details = useRef<HTMLDetailsElement>(null);
  const chip = useRef<HTMLElement>(null);
  const previous = useRef(date);
  useEffect(() => {
    if (previous.current === date) return;
    previous.current = date;
    if (details.current) details.current.open = false;
    chip.current?.focus();
  }, [date]);
  useEffect(() => {
    function closeOnOutsidePress(event: PointerEvent) {
      const open = details.current;
      if (open?.open && event.target instanceof Node) {
        if (!open.contains(event.target)) open.open = false;
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePress);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
    };
  }, []);
  return (
    <details
      ref={details}
      className={className}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !details.current?.open) return;
        // The drawer around the calendar would close on this key too.
        event.stopPropagation();
        details.current.open = false;
        chip.current?.focus();
      }}
    >
      <summary
        ref={chip}
        className={summaryClassName}
        aria-current={date ? 'true' : undefined}
      >
        {summary}
      </summary>
      {children}
    </details>
  );
}
