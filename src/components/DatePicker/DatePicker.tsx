'use client';

import { parseDate } from '@internationalized/date';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Button as AriaButton,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  Heading,
  I18nProvider,
} from 'react-aria-components';
import { classNames } from '@/lib/classNames';
import { dayFlags } from '@/lib/datePicker';
import styles from './DatePicker.module.css';

export type DatePickerProps = {
  /** Accessible name of the calendar, for example "Choose a date". */
  label: string;
  /** The chosen date as YYYY-MM-DD, or null when nothing is chosen. */
  value: string | null;
  /** The venue's current date as YYYY-MM-DD, from the server clock. */
  today: string;
  /** Dates with sessions, as YYYY-MM-DD. Every other date is unavailable. */
  availableDates: readonly string[];
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function DatePicker({
  label,
  value,
  today,
  availableDates,
  disabled = false,
  onChange,
}: DatePickerProps) {
  return (
    // Ramble publishes in US English only, so the grid starts on Sunday as in Figma.
    <I18nProvider locale="en-US">
      <Calendar
        aria-label={label}
        className={classNames(styles.calendar)}
        value={value ? parseDate(value) : null}
        defaultFocusedValue={parseDate(value ?? today)}
        minValue={parseDate(today)}
        isDisabled={disabled}
        isDateUnavailable={(date) =>
          dayFlags(date.toString(), today, availableDates).unavailable
        }
        onChange={(date) => {
          onChange(date.toString());
        }}
      >
        <div className={styles.header}>
          <AriaButton slot="previous" className={classNames(styles.navButton)}>
            <ChevronLeft aria-hidden="true" />
          </AriaButton>
          <Heading className={classNames(styles.month)} />
          <AriaButton slot="next" className={classNames(styles.navButton)}>
            <ChevronRight aria-hidden="true" />
          </AriaButton>
        </div>
        <CalendarGrid className={classNames(styles.grid)} weekdayStyle="short">
          <CalendarGridHeader>
            {(day) => (
              <CalendarHeaderCell className={classNames(styles.weekday)}>
                {day}
              </CalendarHeaderCell>
            )}
          </CalendarGridHeader>
          <CalendarGridBody>
            {(date) => (
              <CalendarCell
                date={date}
                className={classNames(
                  styles.cell,
                  dayFlags(date.toString(), today, availableDates).today &&
                    styles.today,
                )}
              />
            )}
          </CalendarGridBody>
        </CalendarGrid>
      </Calendar>
    </I18nProvider>
  );
}
