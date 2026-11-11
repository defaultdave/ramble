import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { HostDashboard } from './HostDashboard';
import { busy, empty } from './HostDashboard.fixtures';

// The host's home at its phone width: upcoming sessions with seats sold, and the latest bookings.
const meta = {
  title: 'Host/HostDashboard',
  component: HostDashboard,
  args: { view: busy },
  parameters: {
    a11y: {
      config: {
        // Every story renders the page twice, once per color scheme, so a landmark or an id appears twice.
        rules: [
          { id: 'duplicate-id', enabled: false },
          { id: 'duplicate-id-aria', enabled: false },
          { id: 'landmark-unique', enabled: false },
          // PageHeading is a header, and a story shows it outside the page's main landmark.
          { id: 'landmark-banner-is-top-level', enabled: false },
          { id: 'landmark-no-duplicate-banner', enabled: false },
        ],
      },
    },
  },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
} satisfies Meta<typeof HostDashboard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SessionsAndBookings: Story = {};
export const NothingYet: Story = { args: { view: empty } };
