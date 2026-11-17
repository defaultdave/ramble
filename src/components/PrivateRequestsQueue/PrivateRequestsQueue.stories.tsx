import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PageHeading } from '@/components/PageHeading';
import { PrivateRequestsQueue } from './PrivateRequestsQueue';
import {
  longRow,
  noMessageRow,
  shortRow,
} from './PrivateRequestsQueue.fixtures';

// One story per state of the private requests queue: a page of requests, an empty queue, and one with more to load.
const meta = {
  title: 'Ops/PrivateRequestsQueue',
  component: PrivateRequestsQueue,
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
      <PageHeading title="Private requests">
        <Story />
      </PageHeading>
    ),
  ],
  args: {
    rows: [shortRow, longRow, noMessageRow],
    query: {},
    cursor: null,
    nextCursor: null,
  },
} satisfies Meta<typeof PrivateRequestsQueue>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Requests: Story = {};

export const Empty: Story = { args: { rows: [] } };

export const MoreToLoad: Story = { args: { nextCursor: longRow.id } };
