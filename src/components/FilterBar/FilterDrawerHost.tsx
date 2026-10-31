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
import { DisclosureChip } from '@/components/Chip';
import type { FilterDrawer } from '@/components/FilterDrawer';
import { loadDrawer } from './drawerLoader';
import { useFocusMemory } from './focusMemory';
import styles from './FilterBar.module.css';

/** Which button opens the drawer. Filters is also where focus goes when the button that opened it is gone. */
type OpenerKind = 'filters' | 'neighborhood' | 'guests';

type Openers = {
  open: (kind: OpenerKind, button: HTMLButtonElement) => void;
  /** The button waiting for the drawer to arrive. */
  busy: OpenerKind | null;
};

const OpenersContext = createContext<Openers | null>(null);

type FilterRowProps = {
  /** The filter groups the drawer shows. */
  drawer: ReactNode;
  applyLabel: string;
  /** What the row says, visibly and to a screen reader, when the drawer's code could not be fetched. */
  loadFailedMessage: string;
  /** Where Clear all goes. It comes from the server so this file does not pull the route and catalog code into the browser. */
  clearHref: string;
  /** Changes whenever the filters do. */
  filtersKey: string;
  /** The chips of the row. */
  children: ReactNode;
};

/**
 * The row of chips and the drawer that the Filters, Neighborhood and Guests buttons open.
 *
 * The drawer is fetched when first wanted and opens only once it has arrived: until then the
 * button says it is busy and a second press does nothing. A fetch that fails leaves the drawer closed,
 * says so, and the next press tries again. A guest who pressed or focused something else while it
 * was arriving is not pulled into a dialog. The row stays mounted as the filters change, so a
 * chosen chip that clears itself (and so leaves the page with focus on it) hands focus to the Filters
 * button rather than to the page.
 */
export function FilterRow({
  drawer,
  applyLabel,
  loadFailedMessage,
  clearHref,
  filtersKey,
  children,
}: FilterRowProps) {
  const [open, setOpen] = useState(false);
  const [Loaded, setLoaded] = useState<typeof FilterDrawer | null>(null);
  const [busy, setBusy] = useState<OpenerKind | null>(null);
  const [failed, setFailed] = useState(false);
  const router = useRouter();
  const row = useRef<HTMLDivElement>(null);
  const memory = useFocusMemory(row);
  const opener = useRef<HTMLButtonElement | null>(null);
  const waiting = useRef(false);

  function filtersButton() {
    return row.current?.querySelector<HTMLElement>('[data-kind="filters"]');
  }

  useEffect(() => {
    if (memory.focusWasLost()) filtersButton()?.focus();
    // The memory is a stable ref holder; only a change of address should ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  async function openFrom(kind: OpenerKind, button: HTMLButtonElement) {
    if (waiting.current) return;
    waiting.current = true;
    setBusy(kind);
    setFailed(false);
    const away = { moved: false };
    function noteAway(event: Event) {
      if (!(event.target instanceof Node) || !button.contains(event.target)) {
        away.moved = true;
      }
    }
    document.addEventListener('pointerdown', noteAway, true);
    document.addEventListener('focusin', noteAway, true);
    try {
      const component = await loadDrawer();
      setLoaded(() => component);
      if (!away.moved) {
        opener.current = button;
        setOpen(true);
      }
    } catch {
      setFailed(true);
    } finally {
      document.removeEventListener('pointerdown', noteAway, true);
      document.removeEventListener('focusin', noteAway, true);
      waiting.current = false;
      setBusy(null);
    }
  }

  function close() {
    setOpen(false);
    // Safari and Firefox do not focus a button on click, so the dialog has nothing to give focus back to.
    // Two frames: the dialog unmounts after this handler and FocusScope then restores focus in its own frame, and this has to run after that.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const back = opener.current;
        (back?.isConnected ? back : filtersButton())?.focus();
      });
    });
  }

  return (
    <OpenersContext.Provider
      value={{
        open: (kind, button) => {
          void openFrom(kind, button);
        },
        busy,
      }}
    >
      <div
        ref={row}
        role="group"
        aria-label="Quick filters"
        className={styles.row}
        onFocus={(event) => {
          memory.onFocus(event);
          // Focus alone leaves a chip that is half past the edge of the scrolling row half hidden.
          if (event.target instanceof HTMLElement) {
            event.target.scrollIntoView({
              block: 'nearest',
              inline: 'nearest',
            });
          }
        }}
        onBlur={memory.onBlur}
      >
        {children}
      </div>
      <p role="status" className={styles.status}>
        {failed ? loadFailedMessage : ''}
      </p>
      {open && Loaded ? (
        <Loaded
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
        </Loaded>
      ) : null}
    </OpenersContext.Provider>
  );
}

type DrawerButtonProps = {
  kind: OpenerKind;
  label: string;
  /** The number of chosen filters, shown on the Filters button. */
  count?: number;
  iconStart?: ReactNode;
};

export function DrawerButton({
  kind,
  label,
  count,
  iconStart,
}: DrawerButtonProps) {
  const openers = useContext(OpenersContext);
  function prefetch() {
    // The chunk is needed a moment from now; a failure here is reported when the guest actually asks.
    loadDrawer().catch(() => undefined);
  }
  return (
    <DisclosureChip
      popup="dialog"
      label={label}
      {...(count === undefined ? {} : { count })}
      {...(iconStart === undefined ? {} : { iconStart })}
      data-kind={kind}
      aria-busy={openers?.busy === kind ? true : undefined}
      onPointerEnter={prefetch}
      onFocus={prefetch}
      onOpen={(event: MouseEvent<HTMLButtonElement>) => {
        openers?.open(kind, event.currentTarget);
      }}
    />
  );
}
