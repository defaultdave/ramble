import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import { noFilters, type BrowseFilters } from '@/lib/filters';
// The mocks below are registered before FilterBar is first imported, so the test files take the loaders' mocks
// from here and never import FilterBar or the loaders themselves.
import { loadDatePicker, loadedDatePicker } from './datePickerLoader';
import { loadDrawer } from './drawerLoader';
import { FilterBar, type FilterBarProps } from './FilterBar';

// The loaders' mocks, under names of their own: a re-export of a mocked import comes through undefined.
export const drawerFetch = vi.mocked(loadDrawer);
export const calendarFetch = vi.mocked(loadDatePicker);
export const calendarHeld = vi.mocked(loadedDatePicker);

// The chunks the bar fetches are cold on a loaded machine, and a test that waits a second for one should not be the one to pay.
beforeAll(async () => {
  await Promise.all([
    import('@/components/FilterDrawer'),
    import('@/components/DatePicker'),
  ]);
}, 30_000);

// Only the date is pinned: the bar takes "today" as a prop, so nothing here ticks.
const pinnedNow = new Date('2026-10-26T12:00:00Z');
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(pinnedNow);
});
afterEach(() => {
  vi.useRealTimers();
});

// jsdom has no layout, so it has nothing to scroll.
export const scrollIntoView = vi.fn();
Element.prototype.scrollIntoView = scrollIntoView;

export const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// The real fetch by default; a test swaps in one that waits or fails.
vi.mock('./drawerLoader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./drawerLoader')>();
  return { loadDrawer: vi.fn(actual.loadDrawer) };
});
export const real: {
  loadDrawer: typeof loadDrawer;
  loadDatePicker: typeof loadDatePicker;
} = { loadDrawer, loadDatePicker };
beforeEach(async () => {
  const actual =
    await vi.importActual<typeof import('./drawerLoader')>('./drawerLoader');
  real.loadDrawer = actual.loadDrawer;
  drawerFetch.mockReset();
  drawerFetch.mockImplementation(real.loadDrawer);
});

// The real fetch by default, and nothing held yet; a test swaps in one that waits or fails.
vi.mock('./datePickerLoader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./datePickerLoader')>();
  return {
    loadDatePicker: vi.fn(actual.loadDatePicker),
    loadedDatePicker: vi.fn(actual.loadedDatePicker),
  };
});
beforeEach(async () => {
  const actual =
    await vi.importActual<typeof import('./datePickerLoader')>(
      './datePickerLoader',
    );
  real.loadDatePicker = actual.loadDatePicker;
  calendarFetch.mockReset();
  calendarFetch.mockImplementation(real.loadDatePicker);
  calendarHeld.mockReset();
  calendarHeld.mockReturnValue(null);
});

export function deferredCalendar() {
  let finish: () => void = () => undefined;
  const arrives = new Promise<void>((resolve) => {
    finish = resolve;
  });
  calendarFetch.mockImplementation(async () => {
    await arrives;
    return real.loadDatePicker();
  });
  return { finish };
}

export function deferredDrawer() {
  let finish: () => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const arrives = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  drawerFetch.mockImplementation(async () => {
    await arrives;
    return real.loadDrawer();
  });
  return { finish, fail };
}

const categories = [
  { slug: 'cooking', name: 'Cooking' },
  { slug: 'walking-tours', name: 'Walking tours' },
];
const neighborhoods = [
  { slug: 'dumbo', name: 'DUMBO' },
  { slug: 'bushwick', name: 'Bushwick' },
];
const baseProps = {
  categories,
  neighborhoods,
  today: '2026-10-26',
  availableDates: ['2026-10-26', '2026-11-07', '2026-11-08'],
};

/** What the chip says until a day is chosen. The one place that copy is written in these tests. */
export const pickADate = 'Pick a date';

/** The quick-filters row inside `container`. */
export const row = (container: HTMLElement = document.body) =>
  within(within(container).getByRole('group', { name: 'Quick filters' }));
export const filtersButton = () =>
  row().getByRole('button', { name: /^Filters/ });

/** The calendar disclosure in the row: the only unnamed group there. */
export function disclosure(container: HTMLElement = document.body) {
  const element = row(container).getByRole('group');
  if (!(element instanceof HTMLDetailsElement)) {
    throw new Error('The calendar disclosure is not a details element');
  }
  return element;
}

/**
 * The date chip, found by what it says: its summary has no ARIA role to look it up by, so the words are the way in.
 * Pass the chosen day's label once a day is set; `scope` is the row unless a test looks in the drawer.
 */
export function dateChip(
  label: string = pickADate,
  scope: Pick<typeof screen, 'getByText'> = row(),
): HTMLElement {
  return scope.getByText(label);
}

/** The card the disclosure opens: the last thing in it. */
export function calendarCard(details: HTMLDetailsElement): HTMLElement {
  const card = details.lastElementChild;
  if (!(card instanceof HTMLElement)) throw new Error('No calendar card');
  return card;
}

/** The disclosure's live region; the card is closed, so the tree may hide it. */
export const calendarRegion = (details: HTMLDetailsElement) =>
  within(details).getByRole('status', { hidden: true });

/** The drawer's own live region, which is the status outside every calendar disclosure. The open dialog hides the page behind it. */
export function drawerStatus(): HTMLElement {
  const region = screen
    .getAllByRole('status', { hidden: true })
    .find((candidate) => candidate.closest('details') === null);
  if (!region) throw new Error('No drawer status');
  return region;
}

export function bar(
  filters: BrowseFilters,
): React.ReactElement<FilterBarProps> {
  return <FilterBar {...baseProps} filters={filters} onPickDate={vi.fn()} />;
}

export function setup(filters: BrowseFilters = noFilters) {
  const onPickDate = vi.fn();
  render(
    <FilterBar {...baseProps} filters={filters} onPickDate={onPickDate} />,
  );
  return { onPickDate, details: disclosure() };
}

export async function openDrawer(name: string | RegExp = /^Filters/) {
  await userEvent.click(row().getByRole('button', { name }));
  const dialog = await screen.findByRole('dialog', { name: 'Filters' });
  await waitFor(() => {
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
  return dialog;
}
