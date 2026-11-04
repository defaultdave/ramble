'use client';

import { Button } from '@/components/Button';
import {
  HiddenFields,
  type HiddenFieldsProps,
} from '@/components/HiddenFields';
import { Input } from '@/components/Input';
import { ChipGroup, type ChipGroupProps } from './ChipGroup';
import styles from './FilterBar.module.css';

type NoScriptFiltersProps = {
  /** Where the day form goes. */
  action: string;
  /** The name of the day field in the address. */
  dateName: string;
  /** The filters the day form keeps, as the address writes them, without the day. */
  kept: HiddenFieldsProps['fields'];
  /** The venue's current date as YYYY-MM-DD, the earliest day the field offers. */
  today: string;
  /** The chosen day, if any. */
  date: string | null;
  groups: readonly ChipGroupProps[];
};

/**
 * What the drawer and the calendar hold, for a browser with scripting off, where neither opens:
 * every chip is a link and the day is a plain GET form that keeps the other filters.
 * A client component, so the server sends the markup of the <noscript> as it is. In a server
 * component the framework streams the chips outside the <noscript> as templates that a script is
 * meant to swap in, and a browser never parses a template inside a <noscript>, so the swap throws.
 * It takes plain data for the same reason, and so the filter and route code stays out of the browser.
 */
export function NoScriptFilters({
  action,
  dateName,
  kept,
  today,
  date,
  groups,
}: NoScriptFiltersProps) {
  return (
    <noscript>
      <div className={styles.noScript}>
        <form
          className={styles.dayForm}
          action={action}
          method="get"
          aria-label="Choose a day"
        >
          <HiddenFields fields={kept} />
          <Input
            type="date"
            name={dateName}
            label="When"
            min={today}
            {...(date ? { defaultValue: date } : {})}
          />
          <Button type="submit">Show this day</Button>
        </form>
        {groups.map((group) => (
          <ChipGroup key={group.legend} {...group} />
        ))}
      </div>
    </noscript>
  );
}
