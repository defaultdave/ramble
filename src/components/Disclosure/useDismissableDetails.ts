import {
  useEffect,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { dismissAction } from '@/lib/disclosureDismiss';

type Options = {
  /** Keep Escape from reaching a surface around the disclosure, such as a drawer that would close too. */
  stopEscapePropagation?: boolean;
};

/**
 * Wires Escape, an outside press, focus leaving, and a link click to a native `<details>`. Without script the browser still
 * opens and closes it; this only adds the dismissals it lacks. Spread `onKeyDown`, `onBlur`, and `onClick` on the `<details>`. The rule is `dismissAction`.
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
  function onBlur(event: FocusEvent<HTMLDetailsElement>) {
    const element = details.current;
    if (!element) return;
    const next = event.relatedTarget;
    const action = dismissAction({
      kind: 'focus-out',
      open: element.open,
      inside: next instanceof Node ? element.contains(next) : null,
    });
    if (action !== 'none') element.open = false;
  }
  function onClick(event: MouseEvent<HTMLDetailsElement>) {
    const element = details.current;
    if (!element) return;
    if (!(event.target instanceof Element) || !event.target.closest('a')) {
      return;
    }
    const action = dismissAction({
      kind: 'link-click',
      open: element.open,
      inside: true,
    });
    if (action !== 'none') element.open = false;
  }
  return { details, summary, onKeyDown, onBlur, onClick, close };
}
