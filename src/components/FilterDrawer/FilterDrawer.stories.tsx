import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { Chip } from '@/components/Chip';
import { FilterDrawer } from '@/components/FilterDrawer';
import styles from './FilterDrawer.stories.module.css';

const groups = [
  { title: 'When', options: ['Today', 'Tomorrow', 'This weekend'], on: 2 },
  {
    title: 'Neighborhood',
    options: ['Williamsburg', 'Greenpoint', 'Carroll Gardens', 'DUMBO'],
    on: 2,
  },
  {
    title: 'Category',
    options: ['Ceramics and crafts', 'Cooking', 'Walking tours', 'Outdoor'],
    on: 1,
  },
];

// The drawer is a slot shell; these groups only fill it for the story.
const filterGroups = groups.map(({ title, options, on }) => (
  <section key={title} className={styles.group}>
    <h3 className={styles.groupTitle}>{title}</h3>
    <div className={styles.chips}>
      {options.map((label, index) => (
        <Chip
          key={label}
          label={label}
          selected={index === on}
          onToggle={fn()}
        />
      ))}
    </div>
  </section>
));

const meta = {
  title: 'Composites/FilterDrawer',
  component: FilterDrawer,
  args: {
    open: true,
    applyLabel: 'Show 24 results',
    onClose: fn(),
    onClear: fn(),
    onApply: fn(),
    children: filterGroups,
  },
} satisfies Meta<typeof FilterDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

// An open overlay covers the page, so each scheme gets its own story.
export const Light: Story = { parameters: { colorScheme: 'light' } };
export const Dark: Story = { parameters: { colorScheme: 'dark' } };
