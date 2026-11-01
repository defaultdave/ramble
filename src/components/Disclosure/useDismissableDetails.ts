import { useEffect, useRef, type KeyboardEvent } from 'react';
import { dismissAction } from '@/lib/disclosureDismiss';

type Options = {
  /** Keep Escape from reaching a surface around the disclosure, such as a drawer that would close too. */
  stopEscapePropagation?: boolean;
};

/**
 * Wires Escape and an outside press to a native `<details>`. Without script the browser still
 * opens and closes it; this only adds the dismissals it lacks. The rule is `dismissAction`.
 * The press is heard in the capture phase, so a control that stops the event inside the page
 * cannot hide an outside press from it.
 */
export function useDismissableDetails({
  stopEscapePropagation = false,
}: Options = {}) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  useEffect(() => {
    function onPress(event: PointerEvent) {
      const element = details.current;
      if (!element || !(event.target instanceof Node)) return;
      const action = dismissAction({
        kind: 'press',
        open: element.open,
        inside: element.contains(event.target),
      });
      if (action !== 'none') element.open = false;
    }
    document.addEventListener('pointerdown', onPress, true);
    return () => {
      document.removeEventListener('pointerdown', onPress, true);
    };
  }, []);
  function close() {
    if (details.current) details.current.open = false;
  }
  function onKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    const element = details.current;
    if (event.key !== 'Escape' || !element) return;
    const action = dismissAction({
      kind: 'escape',
      open: element.open,
      inside: true,
    });
    if (action === 'none') return;
    if (stopEscapePropagation) event.stopPropagation();
    element.open = false;
    if (action === 'close-and-refocus') summary.current?.focus();
  }
  return { details, summary, onKeyDown, close };
}
