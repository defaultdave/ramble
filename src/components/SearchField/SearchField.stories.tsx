import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { SearchField } from '@/components/SearchField';

const meta = {
  title: 'Ops/SearchField',
  component: SearchField,
  args: {
    path: '/ops/orders',
    query: {},
    value: '',
    label: 'Search orders',
    placeholder: 'Order number or email',
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
      <div style={{ padding: 'var(--space-4)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SearchField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Focus: Story = {
  play: async ({ userEvent }) => {
    await userEvent.tab();
  },
};
export const WithTerm: Story = {
  args: { value: 'alex@example.com', query: { q: 'alex@example.com' } },
};
export const KeepsFilterAndSort: Story = {
  args: {
    value: 'alex',
    query: { q: 'alex', status: 'failed', sort: 'created', dir: 'desc' },
  },
};
