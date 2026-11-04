import { vi } from 'vitest';

type Extent = { scrollWidth: number; clientWidth: number };

/** A box that shows all it holds: nothing to scroll. */
const fits: Extent = { scrollWidth: 0, clientWidth: 0 };

/**
 * jsdom has no layout and no ResizeObserver. This stands one in that never fires by itself, and
 * gives the width every element reports. `resize` sets new widths and fires every observer, as a
 * layout change would. Undo it with `vi.unstubAllGlobals()` and `restoreWidths()`.
 */
export function stubResizeObserver(initial: Extent = fits) {
  const callbacks = new Set<() => void>();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
      }
      observe() {
        callbacks.add(this.callback);
      }
      disconnect() {
        callbacks.delete(this.callback);
      }
    },
  );
  setWidths(initial);
  return {
    resize(next: Extent) {
      setWidths(next);
      callbacks.forEach((callback) => {
        callback();
      });
    },
  };
}

function setWidths({ scrollWidth, clientWidth }: Extent) {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get: () => scrollWidth,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => clientWidth,
  });
}

export function restoreWidths() {
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
}
