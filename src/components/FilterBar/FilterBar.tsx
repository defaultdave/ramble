'use client';

import { Calendar } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { DatePicker } from '@/components/DatePicker';
import { dateChipLabel } from '@/lib/browse';
import {
  activeFilterCount,
  chipState,
  hrefForFilters,
  noFilters,
  toggleFilterValue,
  withDate,
  type BrowseFilters,
  type FilterListKey,
} from '@/lib/filters';
import styles from './FilterBar.module.css';

export type FilterOption = { slug: string; name: string };

export type FilterBarProps = {
  categories: readonly FilterOption[];
  neighborhoods: readonly FilterOption[];
  /** What the address says now. A chip change writes the address and the server sends the new results. */
  filters: BrowseFilters;
  /** The venue's current date as YYYY-MM-DD, from the server clock. */
  today: string;
  /** Days that have a session, as YYYY-MM-DD. */
  availableDates: readonly string[];
};

type ChipGroupProps = {
  legend: string;
  listKey: FilterListKey;
  options: readonly FilterOption[];
  filters: BrowseFilters;
  onChange: (next: BrowseFilters) => void;
};

function ChipGroup({
  legend,
  listKey,
  options,
  filters,
  onChange,
}: ChipGroupProps) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.chips}>
        {options.map(({ slug, name }) => {
          const { selected, disabled } = chipState(filters, listKey, slug);
          return (
            <Chip
              key={slug}
              label={name}
              selected={selected}
              disabled={disabled}
              onToggle={() => {
                onChange(toggleFilterValue(filters, listKey, slug));
              }}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

export function FilterBar({
  categories,
  neighborhoods,
  filters,
  today,
  availableDates,
}: FilterBarProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarId = useId();

  const change = (next: BrowseFilters) => {
    startTransition(() => {
      router.push(hrefForFilters(next));
    });
  };

  return (
    <div className={styles.bar} aria-busy={pending}>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>When</legend>
        <div className={styles.chips}>
          <Chip
            label={filters.date ? dateChipLabel(filters.date) : 'Pick a date'}
            iconStart={<Calendar />}
            selected={filters.date !== null}
            aria-expanded={calendarOpen}
            aria-controls={calendarId}
            onToggle={() => {
              setCalendarOpen((open) => !open);
            }}
          />
        </div>
        {calendarOpen ? (
          <div id={calendarId} className={styles.calendar}>
            <DatePicker
              label="Choose a date"
              value={filters.date}
              today={today}
              availableDates={availableDates}
              onChange={(date) => {
                change(withDate(filters, date));
                setCalendarOpen(false);
              }}
            />
            {filters.date ? (
              <Button
                variant="ghost"
                onClick={() => {
                  change(withDate(filters, null));
                  setCalendarOpen(false);
                }}
              >
                Clear date
              </Button>
            ) : null}
          </div>
        ) : null}
      </fieldset>
      <ChipGroup
        legend="Neighborhood"
        listKey="neighborhoods"
        options={neighborhoods}
        filters={filters}
        onChange={change}
      />
      <ChipGroup
        legend="Category"
        listKey="categories"
        options={categories}
        filters={filters}
        onChange={change}
      />
      {activeFilterCount(filters) > 0 ? (
        <div className={styles.clear}>
          <Button
            variant="ghost"
            onClick={() => {
              change(noFilters);
              setCalendarOpen(false);
            }}
          >
            Clear all filters
          </Button>
        </div>
      ) : null}
    </div>
  );
}
