import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { HostDashboard } from './HostDashboard';
import { busy, empty } from './HostDashboard.fixtures';

// The host's home at its phone width: upcoming sessions with seats sold, and the latest bookings.
const meta = {
  title: 'Host/HostDashboard',
  component: HostDashboard,
  args: { view: busy },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
} satisfies Meta<typeof HostDashboard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SessionsAndBookings: Story = {};
export const NothingYet: Story = { args: { view: empty } };
