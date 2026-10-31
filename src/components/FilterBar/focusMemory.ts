import { useEffect, useRef, type FocusEvent, type RefObject } from 'react';

/** True when `node` has left the page and focus fell back to the page itself, which is what removing the focused element does. */
function focusFellToPage(node: Node | null): boolean {
  if (!node || node.isConnected) return false;
  const { activeElement } = document;
  return !activeElement || activeElement === document.body;
}

/**
 * Remembers the last element that had focus inside a control (`scope`). A browser says nothing when
 * the focused element is removed, so a control that re-renders as the address changes asks afterwards
 * whether its own focus was lost, or whether focus was in it at all. Focus the guest put somewhere
 * else, or that Back and Forward never touched, is never claimed. A blur with no target also happens
 * when a node is removed, so a press outside the control is what forgets it, not the blur alone.
 */
export function useFocusMemory(scope: RefObject<HTMLElement | null>) {
  const last = useRef<Node | null>(null);
  useEffect(() => {
    function forgetOnPressOutside(event: PointerEvent) {
      const inside = scope.current;
      if (inside && event.target instanceof Node) {
        if (!inside.contains(event.target)) last.current = null;
      }
    }
    document.addEventListener('pointerdown', forgetOnPressOutside, true);
    return () => {
      document.removeEventListener('pointerdown', forgetOnPressOutside, true);
    };
  }, [scope]);
  return {
    onFocus: (event: FocusEvent<HTMLElement>) => {
      last.current = event.target;
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      const next = event.relatedTarget;
      if (next instanceof Node && !event.currentTarget.contains(next)) {
        last.current = null;
      }
    },
    /** True once if the remembered element was removed and focus fell to the page. */
    focusWasLost: (): boolean => {
      const lost = focusFellToPage(last.current);
      if (lost) last.current = null;
      return lost;
    },
    /** True once if focus was inside the control the last time it moved. */
    hadFocus: (): boolean => {
      const had = last.current !== null;
      last.current = null;
      return had;
    },
  };
}
