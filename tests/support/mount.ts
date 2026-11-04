import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach } from 'vitest';

/**
 * For a browser test that needs real layout and so cannot use Testing Library's jsdom render. Call
 * it in a describe or at the top of a file: each test gets a fresh container in the body, and it is
 * unmounted and removed afterwards. `mount` renders synchronously and can be called again to swap
 * the tree. `container` is read when called, because the element changes per test.
 */
export function registerMount() {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    container = undefined;
    root = undefined;
  });

  return {
    mount: (node: ReactNode) => {
      const current = root;
      if (!current) throw new Error('mount ran outside a test');
      flushSync(() => {
        current.render(node);
      });
    },
    container: () => {
      if (!container) throw new Error('container read outside a test');
      return container;
    },
  };
}
