import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import {
  UpcomingSessions,
  UpcomingSessionsError,
  UpcomingSessionsSkeleton,
} from './UpcomingSessions';
import {
  lowSpaces,
  mixed,
  none,
  soldOut,
  withSelectedDate,
  withSpaces,
} from './UpcomingSessions.fixtures';

// The dates section of the experience page at its phone width, in each state it can be in
// (Figma 03, the _Flow/SessionRow states open, few-left, and sold-out).
const meta = {
  title: 'Experience/UpcomingSessions',
  component: UpcomingSessions,
  args: { view: withSpaces },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
} satisfies Meta<typeof UpcomingSessions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RowsWithSpaces: Story = {};
export const LowSpaces: Story = { args: { view: lowSpaces } };
export const SoldOutStaysListed: Story = { args: { view: soldOut } };
export const OpenFewLeftAndSoldOut: Story = { args: { view: mixed } };
export const DateFromTheAddress: Story = { args: { view: withSelectedDate } };
export const NoUpcomingSessions: Story = { args: { view: none } };

export const Loading: StoryObj<typeof UpcomingSessionsSkeleton> = {
  render: () => <UpcomingSessionsSkeleton />,
};

export const ReadFailed: StoryObj<typeof UpcomingSessionsError> = {
  render: () => (
    <UpcomingSessionsError retryHref="/experiences/sunset-kayak-1" />
  ),
};
