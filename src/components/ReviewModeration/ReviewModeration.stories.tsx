import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PageHeading } from '@/components/PageHeading';
import { ReviewModeration } from './ReviewModeration';
import { hiddenRow, visibleRow } from './ReviewModeration.fixtures';

// One story per state of the page: visible and hidden reviews together, only hidden ones, an empty list, and one with more to load.
const noop = () => undefined;

const meta = {
  title: 'Ops/ReviewModeration',
  component: ReviewModeration,
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
      <PageHeading title="Guest reviews">
        <Story />
      </PageHeading>
    ),
  ],
  args: {
    rows: [visibleRow, hiddenRow],
    query: {},
    cursor: null,
    nextCursor: null,
    hide: noop,
    unhide: noop,
  },
} satisfies Meta<typeof ReviewModeration>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mixed: Story = {};

export const HiddenOnly: Story = {
  args: { rows: [hiddenRow], query: { status: 'hidden' } },
};

export const Empty: Story = { args: { rows: [] } };

export const MoreToLoad: Story = {
  args: { nextCursor: hiddenRow.id },
};
