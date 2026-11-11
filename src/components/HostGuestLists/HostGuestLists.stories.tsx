import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { HostGuestLists } from './HostGuestLists';
import { all, none, noMatch, searched } from './HostGuestLists.fixtures';

// The host's bookings at the phone width, with the search by reference or guest name.
const meta = {
  title: 'Host/HostGuestLists',
  component: HostGuestLists,
  args: { view: all },
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
} satisfies Meta<typeof HostGuestLists>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LatestBookings: Story = {};
export const SearchResults: Story = { args: { view: searched } };
export const NoMatches: Story = { args: { view: noMatch } };
export const NoBookingsYet: Story = { args: { view: none } };
