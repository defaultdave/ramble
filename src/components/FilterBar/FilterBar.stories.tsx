import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within } from 'storybook/test';
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
    },
  },
};

/** Forty neighborhoods: a phone scrolls each row sideways inside its own box. */
export const ManyChips: Story = {
  args: { neighborhoods: manyNeighborhoods },
};

/** The same, alone on the page, so a phone width shows whether the page itself scrolls sideways. */
export const ManyChipsLight: Story = {
  args: { neighborhoods: manyNeighborhoods },
  parameters: { colorScheme: 'light' },
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
  await userEvent.click(canvas.getByRole('button', { name: 'Pick a date' }));
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
    await userEvent.click(canvas.getByRole('button', { name: 'Sat, Oct 31' }));
    await expect(
      canvas.getByRole('button', { name: 'Clear date' }),
    ).toBeVisible();
  },
};
