'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import styles from './FilterBar.module.css';

// The drawer brings the dialog machinery with it, which a guest who never opens it should not download.
const loadDrawer = () =>
  import('@/components/FilterDrawer').then(({ FilterDrawer }) => ({
    default: FilterDrawer,
  }));
const Drawer = lazy(loadDrawer);

const OpenDrawer = createContext<(() => void) | null>(null);

type FilterRowProps = {
  /** The filter groups the drawer shows. */
  drawer: ReactNode;
  applyLabel: string;
  /** Where Clear all goes. It comes from the server so this file does not pull the route and catalog code into the browser. */
  clearHref: string;
  /** Changes whenever the filters do. */
  filtersKey: string;
  /** The chips of the row. */
  children: ReactNode;
};

/**
 * The row of chips and the drawer that the Filters, Neighborhood and Guests buttons open. The
 * drawer is fetched and mounted when it is first opened, and unmounted when it closes. The row stays
 * mounted as the filters change, so a chosen chip that clears itself (and so leaves the page with
 * focus on it) hands focus to the Filters button rather than to the page.
 */
export function FilterRow({
  drawer,
  applyLabel,
  clearHref,
  filtersKey,
  children,
}: FilterRowProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const row = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<EventTarget | null>(null);

  function focusFiltersButton() {
    row.current?.querySelector<HTMLElement>('[data-filters-button]')?.focus();
  }

  useEffect(() => {
    const focused = lastFocused.current;
    if (!(focused instanceof Node) || focused.isConnected) return;
    lastFocused.current = null;
    const { activeElement } = document;
    if (!activeElement || activeElement === document.body) {
      focusFiltersButton();
    }
  }, [filtersKey]);

  function close() {
    setOpen(false);
    // Safari and Firefox do not focus a button on click, so the dialog has nothing to give focus back to.
    requestAnimationFrame(() => {
      requestAnimationFrame(focusFiltersButton);
    });
  }

  return (
    <OpenDrawer.Provider
      value={() => {
        setOpen(true);
      }}
    >
      <div
        ref={row}
        role="group"
        aria-label="Quick filters"
        className={styles.row}
        onFocus={(event) => {
          lastFocused.current = event.target;
          // Focus alone leaves a chip that is half past the edge of the scrolling row half hidden.
          if (event.target instanceof HTMLElement) {
            event.target.scrollIntoView({
              block: 'nearest',
              inline: 'nearest',
            });
          }
        }}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && !event.currentTarget.contains(next)) {
            lastFocused.current = null;
          }
        }}
      >
        {children}
      </div>
      {open ? (
        <Suspense fallback={null}>
          <Drawer
            open
            applyLabel={applyLabel}
            onClose={close}
            onApply={close}
            onClear={() => {
              close();
              router.push(clearHref);
            }}
          >
            {drawer}
          </Drawer>
        </Suspense>
      ) : null}
    </OpenDrawer.Provider>
  );
}

type DrawerButtonProps = {
  /** The Filters button: where focus returns when the drawer closes. */
  filters?: boolean;
  children: ReactNode;
};

export function DrawerButton({ filters = false, children }: DrawerButtonProps) {
  const open = useContext(OpenDrawer);
  return (
    <button
      type="button"
      className={styles.opener}
      aria-haspopup="dialog"
      data-filters-button={filters ? '' : undefined}
      // The chunk is needed a moment from now; start fetching it.
      onPointerEnter={() => {
        void loadDrawer();
      }}
      onFocus={() => {
        void loadDrawer();
      }}
      onClick={() => {
        open?.();
      }}
    >
      {children}
    </button>
  );
}
