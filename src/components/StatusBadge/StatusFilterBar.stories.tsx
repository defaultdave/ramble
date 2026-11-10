import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { StatusFilterBar } from '@/components/StatusBadge';
import styles from './StatusFilterBar.stories.module.css';

const meta = {
  title: 'Ops/StatusFilterBar',
  component: StatusFilterBar,
  args: {
    path: '/ops/orders',
    query: {},
    label: 'Filter orders by status',
    options: [
      { value: 'paid', label: 'Paid' },
      { value: 'pending', label: 'Pending' },
      { value: 'failed', label: 'Failed' },
      { value: 'refunded', label: 'Refunded' },
    ],
  },
  parameters: {
    a11y: {
      config: {
        // Every story renders the component twice, once per color scheme, so landmarks repeat.
        rules: [{ id: 'landmark-unique', enabled: false }],
      },
    },
  },
  decorators: [
    (Story) => (
      <div className={styles.frame}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StatusFilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllSelected: Story = {};
export const StatusSelected: Story = { args: { query: { status: 'failed' } } };
export const WithCounts: Story = {
  args: {
    query: { status: 'pending' },
    options: [
      { value: 'paid', label: 'Paid', count: 128 },
      { value: 'pending', label: 'Pending', count: 4 },
      { value: 'failed', label: 'Failed', count: 0 },
      { value: 'refunded', label: 'Refunded', count: 12 },
    ],
  },
};
export const Focus: Story = {
  play: async ({ userEvent }) => {
    await userEvent.tab();
  },
};
