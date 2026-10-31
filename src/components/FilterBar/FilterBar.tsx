import { Calendar, SlidersHorizontal, X } from 'lucide-react';
import { Button, ButtonLink } from '@/components/Button';
import { ChipLink } from '@/components/Chip';
import { DatePicker } from '@/components/DatePicker';
import { dateChipLabel } from '@/lib/pages/browse';
import { selectedChips } from '@/lib/filterBar';
import {
  activeFilterCount,
  browseParamNames,
  guestChips,
  hrefForFilters,
  listChips,
  toQuery,
  toQueryEntries,
  withDate,
  type BrowseFilters,
  type ChipView,
} from '@/lib/filters';
import { browsePath } from '@/lib/routes';
import styles from './FilterBar.module.css';
import { DrawerLink, FilterRow } from './FilterDrawerHost';
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

function ChipLinks({ chips }: { chips: readonly ChipView[] }) {
  return chips.map(({ key, label, selected, disabled, href }) => (
    <ChipLink
      key={key}
      label={label}
      selected={selected}
      disabled={disabled}
      href={href}
    />
  ));
}

type ChipGroupProps = {
  legend: string;
  chips: readonly ChipView[];
  /** The target of the chip in the row that goes to this group when there is no script. */
  id?: string;
};

function ChipGroup({ legend, chips, id }: ChipGroupProps) {
  return (
    <fieldset id={id} className={styles.group}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.chips}>
        <ChipLinks chips={chips} />
      </div>
    </fieldset>
  );
}

type WhenControlProps = Pick<
  FilterBarProps,
  'filters' | 'today' | 'availableDates' | 'onPickDate'
> & {
  /** The row opens the calendar as a popover; the drawer shows it in the flow of its group. */
  placement: 'row' | 'drawer';
};

function WhenControl({
  filters,
  today,
  availableDates,
  onPickDate,
  placement,
}: WhenControlProps) {
  const inRow = placement === 'row';
  return (
    <WhenDetails
      summaryClassName={styles.dateChip}
      className={inRow ? styles.whenInRow : styles.whenInDrawer}
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
      <div className={inRow ? styles.popover : styles.calendar}>
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
  );
}

/** The panel a guest with no script reaches from the row's chips: every group, and a plain form for the day. */
function FilterPanel({
  filters,
  today,
  categories,
  neighborhoods,
}: Pick<FilterBarProps, 'filters' | 'today' | 'categories' | 'neighborhoods'>) {
  const others = toQueryEntries({
    filters: withDate(filters, null),
    after: null,
  });
  return (
    <section id="filters" className={styles.panel} aria-label="All filters">
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>Filters</h2>
        <a href="#" className={styles.panelClose} aria-label="Close filters">
          <X aria-hidden="true" />
        </a>
      </div>
      <form method="get" action={browsePath} className={styles.dateForm}>
        {others.map(([name, value]) => (
          <input
            key={`${name}=${value}`}
            type="hidden"
            name={name}
            value={value}
          />
        ))}
        <label className={styles.legend} htmlFor="filters-date">
          When
        </label>
        <input
          id="filters-date"
          type="date"
          name={browseParamNames.date}
          min={today}
          defaultValue={filters.date ?? ''}
          className={styles.dateInput}
        />
        <Button type="submit" variant="secondary">
          Show this day
        </Button>
        {filters.date ? (
          <ButtonLink href={hrefForFilters(withDate(filters, null))}>
            Clear date
          </ButtonLink>
        ) : null}
      </form>
      <ChipGroup
        id="filters-guests"
        legend="Guests"
        chips={guestChips(filters)}
      />
      <ChipGroup
        id="filters-neighborhoods"
        legend="Neighborhood"
        chips={listChips(filters, 'neighborhoods', neighborhoods)}
      />
      <ChipGroup
        legend="Category"
        chips={listChips(filters, 'categories', categories)}
      />
      <div className={styles.panelActions}>
        <ButtonLink href={browsePath}>Clear all</ButtonLink>
        <ButtonLink href={hrefForFilters(filters)} variant="primary">
          Show results
        </ButtonLink>
      </div>
    </section>
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
  const count = activeFilterCount(filters);
  const when = { filters, today, availableDates, onPickDate };
  return (
    <div className={styles.bar}>
      <FilterRow
        filtersKey={toQuery({ filters, after: null })}
        // The count of results is not read for the bar, so the button cannot say how many.
        applyLabel="Show results"
        drawer={
          <>
            <fieldset className={styles.group}>
              <legend className={styles.legend}>When</legend>
              <WhenControl {...when} placement="drawer" />
            </fieldset>
            <ChipGroup legend="Guests" chips={guestChips(filters)} />
            <ChipGroup
              legend="Neighborhood"
              chips={listChips(filters, 'neighborhoods', neighborhoods)}
            />
            <ChipGroup
              legend="Category"
              chips={listChips(filters, 'categories', categories)}
            />
          </>
        }
      >
        <DrawerLink href="#filters" pill>
          <span className={styles.icon} aria-hidden="true">
            <SlidersHorizontal />
          </span>
          Filters
          {count > 0 ? <span className={styles.count}>{count}</span> : null}
        </DrawerLink>
        <WhenControl {...when} placement="row" />
        <ChipLinks
          chips={selectedChips(filters, { categories, neighborhoods })}
        />
        <DrawerLink href="#filters-neighborhoods">Neighborhood</DrawerLink>
        <DrawerLink href="#filters-guests">Guests</DrawerLink>
      </FilterRow>
      <FilterPanel
        filters={filters}
        today={today}
        categories={categories}
        neighborhoods={neighborhoods}
      />
    </div>
  );
}
