import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PageHeading } from '@/components/PageHeading';
import {
  blockedImpact,
  blockedPause,
  blockedSession,
  bookedImpact,
  bookedPause,
  cancelledSession,
  emptyImpact,
  finishPause,
  openSession,
  sessionRows,
} from './OpsSessions.fixtures';
import { SessionDetail } from './SessionDetail';
import { SessionsList } from './SessionsList';

// One story per state: the list (full, empty, more to load) and the session page (open with guests,
// open with none, cancelled, and one a booking blocks).
const noop = () => undefined;

const meta = {
  title: 'Ops/Sessions',
  component: SessionDetail,
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
      <PageHeading title="Session">
        <Story />
      </PageHeading>
    ),
  ],
  args: {
    session: openSession,
    impact: bookedImpact,
    pause: bookedPause,
    actions: { cancel: noop, allocation: noop, pause: noop },
  },
} satisfies Meta<typeof SessionDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpenWithGuests: Story = {};

export const OpenWithNoGuests: Story = {
  args: { impact: emptyImpact, pause: null },
};

export const Cancelled: Story = {
  args: { session: cancelledSession, impact: emptyImpact, pause: null },
};

export const BlockedBookings: Story = {
  args: {
    session: blockedSession,
    impact: blockedImpact,
    pause: blockedPause,
  },
};

export const PausedWithSessionsLeft: Story = {
  args: { pause: finishPause },
};

const listArgs = {
  rows: sessionRows,
  query: {},
  term: '',
  direction: 'desc',
  cursor: null,
  nextCursor: null,
} as const;

export const List: Story = {
  render: () => <SessionsList {...listArgs} />,
};

export const ListEmpty: Story = {
  render: () => <SessionsList {...listArgs} rows={[]} />,
};

export const ListMoreToLoad: Story = {
  render: () => (
    <SessionsList {...listArgs} nextCursor={sessionRows[1]?.id ?? null} />
  ),
};
