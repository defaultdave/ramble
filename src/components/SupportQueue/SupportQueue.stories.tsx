import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PageHeading } from '@/components/PageHeading';
import { SupportQueue } from './SupportQueue';
import { openRow, resolvedRow } from './SupportQueue.fixtures';

// One story per state of the support queue: open and resolved requests together, only open ones, and an empty queue.
const noop = () => undefined;

const meta = {
  title: 'Ops/SupportQueue',
  component: SupportQueue,
  parameters: {
    a11y: {
      config: {
        // Every story renders the page twice, once per color scheme.
        rules: [
          { id: 'duplicate-id', enabled: false },
          { id: 'duplicate-id-aria', enabled: false },
          { id: 'landmark-unique', enabled: false },
          { id: 'landmark-banner-is-top-level', enabled: false },
          { id: 'landmark-no-duplicate-banner', enabled: false },
          { id: 'page-has-heading-one', enabled: false },
        ],
      },
    },
  },
  decorators: [
    (Story) => (
      <PageHeading title="Support">
        <Story />
      </PageHeading>
    ),
  ],
  args: {
    rows: [openRow, resolvedRow],
    query: {},
    cursor: null,
    nextCursor: null,
    resolve: noop,
  },
} satisfies Meta<typeof SupportQueue>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mixed: Story = {};

export const OpenOnly: Story = {
  args: { rows: [openRow], query: { status: 'open' } },
};

export const Empty: Story = { args: { rows: [] } };

export const MoreToLoad: Story = {
  args: { nextCursor: resolvedRow.id },
};
