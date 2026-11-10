import { Calendar, SlidersHorizontal } from 'lucide-react';
import { ButtonLink } from '@/components/Button';
import { ChipLink } from '@/components/Chip';
import {
  calendarLoadFailedMessage,
  calendarLoadingMessage,
  drawerLoadFailedMessage,
  selectedChips,
} from '@/lib/filterBar';
import {
  activeFilterCount,
  ageChips,
  browseParamNames,
  guestChips,
  hrefForFilters,
  listChips,
  priceChips,
  settingChips,
  toQuery,
  toQueryEntries,
  withDate,
  type BrowseFilters,
} from '@/lib/filters';
import { browsePath } from '@/lib/routes';
import { dateChipLabel } from '@/lib/time';
import { ChipGroup, type ChipGroupProps } from './ChipGroup';
import styles from './FilterBar.module.css';
import { DrawerButton, FilterRow } from './FilterDrawerHost';
import { LazyDatePicker } from './LazyDatePicker';
import { NoScriptFilters } from './NoScriptFilters';
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

type ChipGroupsOptions = Pick<FilterBarProps, 'filters'> & {
  categories: readonly FilterOption[];
  neighborhoods: readonly FilterOption[];
};

/** The drawer's chip groups, which the no-script bar shows again in the page. */
function chipGroups({
  filters,
  categories,
  neighborhoods,
}: ChipGroupsOptions): ChipGroupProps[] {
  return [
    { legend: 'Guests', chips: guestChips(filters) },
    {
      legend: 'Neighborhood',
      chips: listChips(filters, 'neighborhoods', neighborhoods),
    },
    { legend: 'Category', chips: listChips(filters, 'categories', categories) },
    { legend: 'Price', chips: priceChips(filters) },
    { legend: 'Age', chips: ageChips(filters) },
    { legend: 'Indoor or outdoor', chips: settingChips(filters) },
  ];
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
        <LazyDatePicker
          label="Choose a date"
          value={filters.date}
          today={today}
          availableDates={availableDates}
          onChange={onPickDate}
          loadingMessage={calendarLoadingMessage()}
          loadFailedMessage={calendarLoadFailedMessage()}
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
  const groups = chipGroups({ filters, categories, neighborhoods });
  return (
    <div className={styles.bar}>
      <FilterRow
        filtersKey={toQuery({ filters, after: null })}
        // The number of results is not read for the bar, so the button cannot say how many.
        applyLabel="Show results"
        loadFailedMessage={drawerLoadFailedMessage()}
        clearHref={browsePath}
        drawer={
          <>
            <fieldset className={styles.group}>
              <legend className={styles.legend}>When</legend>
              <WhenControl {...when} placement="drawer" />
            </fieldset>
            {groups.map((group) => (
              <ChipGroup key={group.legend} {...group} />
            ))}
          </>
        }
      >
        <DrawerButton
          kind="filters"
          label="Filters"
          iconStart={<SlidersHorizontal />}
          {...(count > 0 ? { count } : {})}
        />
        <WhenControl {...when} placement="row" />
        {selectedChips(filters, { categories, neighborhoods }).map(
          ({ key, label, href, hint }) => (
            <ChipLink
              key={key}
              label={label}
              href={href}
              hint={hint}
              selected
            />
          ),
        )}
        {filters.neighborhoods.length === 0 ? (
          <DrawerButton kind="neighborhood" label="Neighborhood" />
        ) : null}
        {filters.guests === null ? (
          <DrawerButton kind="guests" label="Guests" />
        ) : null}
      </FilterRow>
      <NoScriptFilters
        action={browsePath}
        dateName={browseParamNames.date}
        kept={toQueryEntries({ filters: withDate(filters, null), after: null })}
        today={today}
        date={filters.date}
        groups={groups}
      />
    </div>
  );
}
