'use client';

import {
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
} from 'react';
import type { DatePicker, DatePickerProps } from '@/components/DatePicker';
import { visibleDate, weeksInMonthOf } from '@/lib/datePicker';
import { loadDatePicker, loadedDatePicker } from './datePickerLoader';
import styles from './FilterBar.module.css';
import { useWhenDisclosure } from './WhenDetails';

type LazyDatePickerProps = DatePickerProps & {
  /** What the stand-in says while the calendar's code is on its way. It comes from the server so this file does not pull the filter and route code into the browser. */
  loadingMessage: string;
  /** What the stand-in says when that code could not be fetched. */
  loadFailedMessage: string;
};

/**
 * The calendar of the date disclosure, fetched the first time the disclosure opens. Until it
 * arrives a box the size of the month stands in, so the card does not jump, and says so to a
 * screen reader. A failed fetch says so in the same box and the next open tries again. Focus is
 * never moved: the chip keeps it, and the calendar is the next stop when the guest tabs on.
 * Once the component is held it stays one element through every pick, so the calendar is never remounted.
 */
export function LazyDatePicker({
  loadingMessage,
  loadFailedMessage,
  ...props
}: LazyDatePickerProps) {
  const { opens, contentChanged } = useWhenDisclosure();
  // A fetch that finished before this mounted (the drawer mounts it afresh each time) is held at once.
  const [Picker, setPicker] = useState<typeof DatePicker | null>(
    loadedDatePicker,
  );
  const [failedAt, setFailedAt] = useState(0);

  useEffect(() => {
    if (opens === 0 || Picker) return;
    let current = true;
    loadDatePicker().then(
      (component) => {
        if (current) setPicker(() => component);
      },
      () => {
        if (current) setFailedAt(opens);
      },
    );
    return () => {
      current = false;
    };
  }, [opens, Picker]);

  useLayoutEffect(() => {
    if (Picker) contentChanged();
  }, [Picker, contentChanged]);

  if (Picker) return <Picker {...props} />;
  const asked = opens > 0;
  const failed = asked && failedAt === opens;
  const weeks = weeksInMonthOf(visibleDate(props));
  // Closed, the box is empty and says nothing: only a guest who opened the card is waiting.
  return (
    <div
      role={asked ? 'status' : undefined}
      aria-busy={asked && !failed ? true : undefined}
      data-failed={failed || undefined}
      className={styles.calendarPlaceholder}
      style={{ '--weeks': weeks } as CSSProperties}
    >
      {asked ? (failed ? loadFailedMessage : loadingMessage) : null}
    </div>
  );
}
