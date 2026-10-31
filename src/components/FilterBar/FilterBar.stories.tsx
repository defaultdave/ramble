import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { noFilters } from '@/lib/filters';
import { FilterBar } from '@/components/FilterBar';
import styles from './FilterBar.stories.module.css';

const categories = [
  { slug: 'ceramics-and-crafts', name: 'Ceramics and crafts' },
  { slug: 'cooking', name: 'Cooking' },
  { slug: 'walking-tours', name: 'Walking tours' },
  { slug: 'wine-and-cocktails', name: 'Wine and cocktails' },
  { slug: 'food-and-coffee', name: 'Food and coffee' },
  { slug: 'outdoor', name: 'Outdoor' },
  { slug: 'wellness', name: 'Wellness' },
  { slug: 'kids', name: 'Kids' },
];

const neighborhoods = [
  { slug: 'williamsburg', name: 'Williamsburg' },
  { slug: 'greenpoint', name: 'Greenpoint' },
  { slug: 'carroll-gardens', name: 'Carroll Gardens' },
  { slug: 'dumbo', name: 'DUMBO' },
  { slug: 'park-slope', name: 'Park Slope' },
  { slug: 'bushwick', name: 'Bushwick' },
];

const manyNeighborhoods = Array.from({ length: 40 }, (_, index) => ({
  slug: `neighborhood-${String(index)}`,
  name: `Neighborhood number ${String(index + 1)}`,
}));

const meta = {
  title: 'Composites/FilterBar',
  component: FilterBar,
  parameters: { nextjs: { appDirectory: true } },
  args: {
    categories,
    neighborhoods,
    filters: noFilters,
    onPickDate: fn(),
    today: '2026-10-26',
    availableDates: [
      '2026-10-26',
      '2026-10-28',
      '2026-10-31',
      '2026-11-01',
      '2026-11-07',
      '2026-11-08',
    ],
  },
  decorators: [
    (Story) => (
      <div className={styles.frame}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NothingChosen: Story = {};

export const WithFilters: Story = {
  args: {
    filters: {
      categories: ['cooking'],
      neighborhoods: ['carroll-gardens'],
      date: '2026-10-31',
      guests: null,
    },
  },
};

const manyChosen = {
  categories: categories.slice(0, 5).map(({ slug }) => slug),
  neighborhoods: neighborhoods.map(({ slug }) => slug),
  date: '2026-10-31',
  guests: 4,
};

/** Every group chosen: the row grows past the screen and scrolls sideways inside its own box. */
export const ManyChosen: Story = {
  args: { filters: manyChosen },
};

/** The same, alone on the page, so a phone width shows whether the page itself scrolls sideways. */
export const ManyChosenLight: Story = {
  args: { filters: manyChosen },
  parameters: { colorScheme: 'light' },
};

/** Forty neighborhoods: they live in the drawer, so the row stays one row. */
export const ManyNeighborhoods: Story = {
  args: { neighborhoods: manyNeighborhoods },
  parameters: { colorScheme: 'light' },
};

const openDrawer: Story['play'] = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: /^Filters/ }));
  await expect(
    await within(document.body).findByRole('dialog', { name: 'Filters' }),
  ).toBeInTheDocument();
};

/** The drawer opens from the Filters chip, with every group. */
export const DrawerOpen: Story = {
  args: { filters: { ...manyChosen, categories: ['cooking'] } },
  parameters: { colorScheme: 'light' },
  play: openDrawer,
};

export const DrawerOpenDark: Story = {
  args: { filters: { ...manyChosen, categories: ['cooking'] } },
  parameters: { colorScheme: 'dark' },
  play: openDrawer,
};

export const AtTheLimit: Story = {
  args: {
    filters: {
      ...noFilters,
      categories: categories.slice(0, 8).map(({ slug }) => slug),
    },
  },
};

const openCalendar: Story['play'] = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByText('Pick a date'));
  await expect(canvas.getByRole('grid')).toBeVisible();
};

// A story with a play function shows one scheme, because the same click would otherwise match twice.
/** The calendar opens from the date chip, on the month of today. */
export const CalendarOpen: Story = {
  parameters: { colorScheme: 'light' },
  play: openCalendar,
};

export const CalendarOpenDark: Story = {
  parameters: { colorScheme: 'dark' },
  play: openCalendar,
};

export const CalendarOpenWithDate: Story = {
  args: { filters: { ...noFilters, date: '2026-10-31' } },
  parameters: { colorScheme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Sat, Oct 31'));
    await expect(
      canvas.getByRole('link', { name: 'Clear date' }),
    ).toBeVisible();
  },
};

/** The open calendar in the 288 px a 320 px phone leaves: the days must not run past the calendar box. */
export const CalendarOpenAtPhoneWidth: Story = {
  parameters: { colorScheme: 'light' },
  decorators: [
    (Story) => (
      <div className={styles.phone}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Pick a date'));
    const grid = canvas.getByRole('grid');
    const box = grid.closest('details > div');
    if (!box) throw new Error('No calendar box');
    const edge = box.getBoundingClientRect().right;
    for (const cell of canvas.getAllByRole('gridcell')) {
      await expect(cell.getBoundingClientRect().right).toBeLessThanOrEqual(
        edge,
      );
    }
    await expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
  },
};

/** A stand-in for the route: the day the calendar picks becomes the chosen date, as the Server Action's redirect does. */
function DayChangesInPlace(args: React.ComponentProps<typeof FilterBar>) {
  const [date, setDate] = useState<string | null>(null);
  return (
    <FilterBar
      {...args}
      filters={{ ...args.filters, date }}
      onPickDate={setDate}
    />
  );
}

/** Picking a day closes the calendar and leaves focus on the chip, not on the page. */
export const FocusStaysOnTheChipWhenTheDayChanges: Story = {
  parameters: { colorScheme: 'light' },
  render: (args) => <DayChangesInPlace {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = canvas.getByText('Pick a date').closest('summary');
    const disclosure = chip?.closest('details');
    if (!chip || !disclosure) throw new Error('No date disclosure');
    await userEvent.click(chip);
    await waitFor(() => expect(disclosure).toHaveProperty('open', true));

    await userEvent.click(
      canvas.getByRole('button', { name: /Saturday, October 31, 2026/ }),
    );

    await waitFor(() => expect(disclosure).toHaveProperty('open', false));
    await waitFor(() =>
      expect(canvas.getByText('Sat, Oct 31').closest('details')).toBe(
        disclosure,
      ),
    );
    await waitFor(() => expect(chip).toHaveFocus());
  },
};
