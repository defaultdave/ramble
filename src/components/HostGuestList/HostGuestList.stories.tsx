import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { HostGuestList } from './HostGuestList';
import { busy, empty } from './HostGuestList.fixtures';

// One session's guests at the phone width: party, ages, waiver, and contacts for each booking.
const meta = {
  title: 'Host/HostGuestList',
  component: HostGuestList,
  args: { view: busy },
  parameters: {
    a11y: {
      config: {
        rules: [
          // Every story renders the page twice, once per color scheme, so a landmark or an id appears twice.
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
} satisfies Meta<typeof HostGuestList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithGuests: Story = {};
export const NoBookings: Story = { args: { view: empty } };
