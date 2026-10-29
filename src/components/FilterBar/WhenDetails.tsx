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
 * and puts focus back on the chip, where a keyboard user was.
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
  return (
    <details ref={details} className={className}>
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
