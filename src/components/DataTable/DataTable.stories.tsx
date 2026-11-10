import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import type { StatusTone } from '@/lib/statusBadge';
import styles from './DataTable.stories.module.css';

type OrderRow = {
  id: string;
  guest: string;
  experience: string;
  status: { tone: StatusTone; label: string };
  total: string;
};

const rows: OrderRow[] = [
  {
    id: 'o-1',
    guest: 'Alex Rivera',
    experience: 'Sunset kayak paddle',
    status: { tone: 'success', label: 'Paid' },
    total: '$96.00',
  },
  {
    id: 'o-2',
    guest: 'Sam Okafor',
    experience: 'Pasta from scratch',
    status: { tone: 'warning', label: 'Pending' },
    total: '$128.00',
  },
  {
    id: 'o-3',
    guest: 'Jo Lindqvist',
    experience: 'Ceramics for beginners',
    status: { tone: 'danger', label: 'Failed' },
    total: '$54.00',
  },
  {
    id: 'o-4',
    guest: 'Priya Nair',
    experience: 'Old town walking tour',
    status: { tone: 'neutral', label: 'Refunded' },
    total: '$40.00',
  },
];

const columns: DataTableColumn<OrderRow>[] = [
  {
    id: 'guest',
    header: 'Guest',
    cell: (row) => row.guest,
    sortable: true,
    rowHeader: true,
  },
  { id: 'experience', header: 'Experience', cell: (row) => row.experience },
  {
    id: 'status',
    header: 'Status',
    cell: (row) => <StatusBadge {...row.status} />,
  },
  {
    id: 'total',
    header: 'Total',
    cell: (row) => row.total,
    sortable: true,
    align: 'end',
  },
];

const meta = {
  title: 'Ops/DataTable',
  component: DataTable<OrderRow>,
  args: {
    caption: 'Orders',
    columns,
    rows,
    rowId: (row) => row.id,
    path: '/ops/orders',
    query: {},
    sort: { column: 'guest', direction: 'asc' },
    cursor: null,
    nextCursor: null,
    empty: {
      title: 'No orders yet',
      body: 'Orders show up here once a guest books.',
    },
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
} satisfies Meta<typeof DataTable<OrderRow>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SortedAscending: Story = {};
export const SortedDescending: Story = {
  args: { sort: { column: 'total', direction: 'desc' } },
};
export const FirstPageWithMore: Story = {
  args: { nextCursor: 'o-4', query: { status: 'all', sort: 'guest' } },
};
export const MiddlePage: Story = {
  args: { cursor: 'o-4', nextCursor: 'o-8' },
};
export const LastPage: Story = { args: { cursor: 'o-8' } };
export const Empty: Story = { args: { rows: [] } };
export const EmptyPastTheLastPage: Story = {
  args: { rows: [], cursor: 'o-40', empty: { title: 'No more orders' } },
};
export const LoadFailed: Story = {
  args: {
    error: {
      title: 'Orders could not load',
      body: 'Nothing was changed. Try again in a moment.',
      retryHref: '/ops/orders',
    },
  },
};
export const Focus: Story = {
  play: async ({ userEvent }) => {
    await userEvent.tab();
  },
};
