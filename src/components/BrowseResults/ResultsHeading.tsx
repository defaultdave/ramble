'use client';

import { useEffect, useRef, type ReactNode } from 'react';

// False until the first heading has mounted, so the page's first paint (and the skeleton's swap for
// the results) never takes focus; only a heading that arrives after that does.
let arrived = false;

type ResultsHeadingProps = {
  className?: string | undefined;
  children: ReactNode;
};

/**
 * The heading over the results. When the results change and the control that caused it has gone
 * (the empty state's "See Sat, Nov 7" link is replaced by the new results), focus would be lost to
 * the page, so it moves here. A chip or the date chip still on the page keeps its focus.
 */
export function ResultsHeading({ className, children }: ResultsHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const focusLost =
      document.activeElement === null ||
      document.activeElement === document.body;
    if (arrived && focusLost) ref.current?.focus();
    arrived = true;
  }, [children]);
  return (
    <h2 ref={ref} tabIndex={-1} className={className}>
      {children}
    </h2>
  );
}
