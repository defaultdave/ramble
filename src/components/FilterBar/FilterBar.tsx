import { Calendar } from 'lucide-react';
import Link from 'next/link';
import { ChipLink } from '@/components/Chip';
import { DatePicker } from '@/components/DatePicker';
import { dateChipLabel } from '@/lib/browse';
import {
  activeFilterCount,
  browsePath,
  chipState,
  hrefForFilters,
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
  /** What the address says now. Every chip is a link to the address with that chip turned on or off. */
  filters: BrowseFilters;
  /** The venue's current date as YYYY-MM-DD, from the server clock. */
  today: string;
  /** Days that have a session, as YYYY-MM-DD. */
  availableDates: readonly string[];
  /** Called with the day the calendar picked. The route supplies the Server Action that moves to its address. */
  onPickDate: (date: string) => unknown;
};

type ChipGroupProps = {
  legend: string;
  listKey: FilterListKey;
  options: readonly FilterOption[];
  filters: BrowseFilters;
};

function ChipGroup({ legend, listKey, options, filters }: ChipGroupProps) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.chips}>
        {options.map(({ slug, name }) => {
          const { selected, disabled } = chipState(filters, listKey, slug);
          return (
            <ChipLink
              key={slug}
              label={name}
              selected={selected}
              disabled={disabled}
              href={hrefForFilters(toggleFilterValue(filters, listKey, slug))}
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
  onPickDate,
}: FilterBarProps) {
  return (
    <div className={styles.bar}>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>When</legend>
        {/* The browser opens and closes the calendar, so the chip needs no script. The key closes it again once a day is chosen. */}
        <details key={filters.date ?? 'none'} className={styles.when}>
          <summary
            className={styles.dateChip}
            aria-current={filters.date ? 'true' : undefined}
          >
            <span className={styles.icon} aria-hidden="true">
              <Calendar />
            </span>
            {filters.date ? dateChipLabel(filters.date) : 'Pick a date'}
          </summary>
          <div className={styles.calendar}>
            <DatePicker
              label="Choose a date"
              value={filters.date}
              today={today}
              availableDates={availableDates}
              onChange={onPickDate}
            />
            {filters.date ? (
              <Link
                className={styles.link}
                href={hrefForFilters(withDate(filters, null))}
                prefetch={false}
              >
                Clear date
              </Link>
            ) : null}
          </div>
        </details>
      </fieldset>
      <ChipGroup
        legend="Neighborhood"
        listKey="neighborhoods"
        options={neighborhoods}
        filters={filters}
      />
      <ChipGroup
        legend="Category"
        listKey="categories"
        options={categories}
        filters={filters}
      />
      {activeFilterCount(filters) > 0 ? (
        <div className={styles.clear}>
          <Link className={styles.link} href={browsePath} prefetch={false}>
            Clear all filters
          </Link>
        </div>
      ) : null}
    </div>
  );
}
