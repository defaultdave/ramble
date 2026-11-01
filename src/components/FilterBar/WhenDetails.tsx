'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { loadDatePicker } from './datePickerLoader';
import { useFocusMemory } from './focusMemory';

/** Space kept between the date chip and a calendar card that rises from the foot of the screen. */
const cardGapPx = 8;

function prefetch() {
  loadDatePicker().catch(() => undefined);
}

type Disclosure = {
  /** How many times the disclosure has been opened. Zero until the first time. */
  opens: number;
  /** The card inside changed size or content while open, so it needs placing against the chip again. */
  contentChanged: () => void;
};

const DisclosureContext = createContext<Disclosure>({
  opens: 0,
  contentChanged: () => undefined,
});

/** What the calendar inside the disclosure needs to know: when it was first wanted, and when a later open asks to try again. */
export function useWhenDisclosure() {
  return useContext(DisclosureContext);
}

type WhenDetailsProps = {
  className?: string | undefined;
  summaryClassName?: string | undefined;
  /** What the date chip says. */
  summary: ReactNode;
  /** The chosen day. When it changes, the calendar closes and, if focus was in it, focus goes back to the chip. */
  date: string | null;
  children: ReactNode;
};

/**
 * The calendar disclosure. The browser opens and closes it, so the chip needs no script to work.
 * It stays mounted when a day is picked (a new key would drop focus to the page), so this closes it
 * and, when focus was in the control, puts focus back on the chip, where a keyboard user was. A day
 * that changes by Back or Forward, or from elsewhere on the page, moves no focus. Escape closes it
 * too, and so does a press anywhere outside it, because the calendar can float over the page.
 * What is inside learns when it is opened (see `useWhenDisclosure`), so its code can be fetched then.
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
  const memory = useFocusMemory(details);
  const [opens, setOpens] = useState(0);
  const keepChipClear = useCallback(() => {
    const disclosure = details.current;
    const card = disclosure?.lastElementChild;
    const chipElement = chip.current;
    if (!disclosure?.open || !card || !chipElement) return;
    // A card at the foot of a short screen would sit over the chip that opened it.
    if (getComputedStyle(card).position !== 'fixed') return;
    const overlap =
      chipElement.getBoundingClientRect().bottom +
      cardGapPx -
      card.getBoundingClientRect().top;
    if (overlap > 0) window.scrollBy({ top: overlap });
  }, []);
  const disclosure = useMemo(
    () => ({ opens, contentChanged: keepChipClear }),
    [opens, keepChipClear],
  );
  useEffect(() => {
    if (previous.current === date) return;
    previous.current = date;
    const hadFocus = memory.hadFocus();
    if (details.current) details.current.open = false;
    if (hadFocus) chip.current?.focus();
    // The memory only reads a ref; the day changing is what asks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);
  useEffect(() => {
    function closeOnOutsidePress(event: PointerEvent) {
      const open = details.current;
      if (open?.open && event.target instanceof Node) {
        if (!open.contains(event.target)) open.open = false;
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePress);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
    };
  }, []);
  return (
    <details
      ref={details}
      className={className}
      onFocus={memory.onFocus}
      onBlur={memory.onBlur}
      onToggle={(event) => {
        if (!event.currentTarget.open) return;
        setOpens((count) => count + 1);
        keepChipClear();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !details.current?.open) return;
        // The drawer around the calendar would close on this key too.
        event.stopPropagation();
        details.current.open = false;
        chip.current?.focus();
      }}
    >
      <summary
        ref={chip}
        className={summaryClassName}
        aria-current={date ? 'true' : undefined}
        // A failure here is reported when the guest actually opens it.
        onPointerEnter={prefetch}
        onFocus={prefetch}
      >
        {summary}
      </summary>
      <DisclosureContext.Provider value={disclosure}>
        {children}
      </DisclosureContext.Provider>
    </details>
  );
}
