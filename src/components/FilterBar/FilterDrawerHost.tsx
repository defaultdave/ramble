'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { FilterDrawer } from '@/components/FilterDrawer';
import { browsePath } from '@/lib/routes';
import styles from './FilterBar.module.css';

const OpenDrawer = createContext<(() => void) | null>(null);

type FilterRowProps = {
  /** The filter groups the drawer shows. */
  drawer: ReactNode;
  applyLabel: string;
  /** Changes whenever the filters do. */
  filtersKey: string;
  /** The chips of the row. */
  children: ReactNode;
};

/**
 * The single row of chips, and the drawer the Filters, Neighborhood and Guests chips open. Each of
 * those chips is a link to its group in the page's own panel, so it works with no script; here
 * the click opens the drawer instead. The row stays mounted as the filters change, so a chosen
 * chip that clears itself hands focus to the Filters chip rather than to the page.
 */
export function FilterRow({
  drawer,
  applyLabel,
  filtersKey,
  children,
}: FilterRowProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const row = useRef<HTMLDivElement>(null);
  const focusWasInRow = useRef(false);

  useEffect(() => {
    if (!focusWasInRow.current) return;
    const { activeElement } = document;
    if (activeElement && activeElement !== document.body) return;
    row.current?.querySelector<HTMLElement>('[data-filters-pill]')?.focus();
  }, [filtersKey]);

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
        onFocus={() => {
          focusWasInRow.current = true;
        }}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && !event.currentTarget.contains(next)) {
            focusWasInRow.current = false;
          }
        }}
      >
        {children}
      </div>
      <FilterDrawer
        open={open}
        applyLabel={applyLabel}
        onClose={() => {
          setOpen(false);
        }}
        onApply={() => {
          setOpen(false);
        }}
        onClear={() => {
          setOpen(false);
          router.push(browsePath);
        }}
      >
        {drawer}
      </FilterDrawer>
    </OpenDrawer.Provider>
  );
}

type DrawerLinkProps = {
  /** Where the link goes with no script: its group in the page's own panel. */
  href: string;
  pill?: boolean;
  children: ReactNode;
};

export function DrawerLink({ href, pill = false, children }: DrawerLinkProps) {
  const open = useContext(OpenDrawer);
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    const plain =
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey;
    if (!open || !plain) return;
    event.preventDefault();
    open();
  }
  return (
    <a
      href={href}
      className={styles.opener}
      aria-haspopup="dialog"
      data-filters-pill={pill ? '' : undefined}
      onClick={onClick}
    >
      {children}
    </a>
  );
}
