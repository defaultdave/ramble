'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
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
  // A warm-up can land after this mounted, so each open looks again before it shows a stand-in.
  const [seenOpens, setSeenOpens] = useState(opens);
  if (seenOpens !== opens) {
    setSeenOpens(opens);
    const held = loadedDatePicker();
    if (held && !Picker) setPicker(() => held);
  }

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
  // The live region is there from the first render and empty until a guest opens the card, so its text is announced as it changes.
  return (
    <div
      role="status"
      aria-busy={asked && !failed ? true : undefined}
      data-failed={failed || undefined}
      data-weeks={weeksInMonthOf(visibleDate(props))}
      className={styles.calendarPlaceholder}
    >
      {asked ? (failed ? loadFailedMessage : loadingMessage) : null}
    </div>
  );
}
