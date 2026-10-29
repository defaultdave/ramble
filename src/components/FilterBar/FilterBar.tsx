import { Calendar } from 'lucide-react';
import { ButtonLink } from '@/components/Button';
import { ChipLink } from '@/components/Chip';
import { DatePicker } from '@/components/DatePicker';
import { dateChipLabel } from '@/lib/browse';
import {
  activeFilterCount,
  chipState,
  hrefForFilters,
  toggleFilterValue,
  withDate,
  type BrowseFilters,
  type FilterListKey,
} from '@/lib/filters';
import { browsePath } from '@/lib/routes';
import styles from './FilterBar.module.css';
import { WhenDetails } from './WhenDetails';

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
        <WhenDetails
          summaryClassName={styles.dateChip}
          className={styles.when}
          summary={
            <>
              <span className={styles.icon} aria-hidden="true">
                <Calendar />
              </span>
              {filters.date ? dateChipLabel(filters.date) : 'Pick a date'}
            </>
          }
          date={filters.date}
        >
          <div className={styles.calendar}>
            <DatePicker
              label="Choose a date"
              value={filters.date}
              today={today}
              availableDates={availableDates}
              onChange={onPickDate}
            />
            {filters.date ? (
              <ButtonLink href={hrefForFilters(withDate(filters, null))}>
                Clear date
              </ButtonLink>
            ) : null}
          </div>
        </WhenDetails>
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
          <ButtonLink href={browsePath}>Clear all filters</ButtonLink>
        </div>
      ) : null}
    </div>
  );
}
