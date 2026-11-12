import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ActionNotice } from '@/components/ActionNotice';
import { PageHeading } from '@/components/PageHeading';
import { availabilityNotices } from '@/lib/availability';
import { experienceId, slots } from './Availability.fixtures';
import { AvailabilityView } from './AvailabilityView';

// One story per state of the availability page: slots set up, none yet, a refused add, and the
// notice a refused seat change shows, on a phone and a desktop.
const noop = () => undefined;

const meta = {
  title: 'Ops/Availability',
  component: AvailabilityView,
  args: {
    experienceId,
    timeZone: 'America/New_York',
    slots,
    addSlots: noop,
    saveSeats: noop,
  },
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
      <PageHeading title="Availability: Pottery">
        <Story />
      </PageHeading>
    ),
  ],
} satisfies Meta<typeof AvailabilityView>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };

export const SlotsMobile: Story = { globals: mobile };

export const SlotsDesktop: Story = { globals: desktop };

export const NoSlotsMobile: Story = { globals: mobile, args: { slots: [] } };

export const RefusedAddMobile: Story = {
  globals: mobile,
  args: { problems: ['weekdays', 'startTime', 'allocation', 'source'] },
};

export const RefusedAddDesktop: Story = {
  globals: desktop,
  args: { problems: ['weekdays', 'startTime', 'durationMinutes'] },
};

export const SeatsRefusedNoticeMobile: Story = {
  globals: mobile,
  render: (args) => (
    <>
      <ActionNotice notice={availabilityNotices.below_sold_and_held} />
      <AvailabilityView {...args} />
    </>
  ),
};
