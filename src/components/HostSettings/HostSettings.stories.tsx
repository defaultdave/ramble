import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { hostNotices } from '@/lib/hostSetup';
import { HostSettings } from './HostSettings';

// The host's own settings form at the phone width: filled, saved, refused fields, and a host with nothing optional set.
const meta = {
  title: 'Host/HostSettings',
  component: HostSettings,
  args: {
    values: {
      name: 'Spoke & Saddle',
      description: 'Two cycling teachers who lead small, unhurried rides.',
      notificationEmail: 'bookings@spokeandsaddle.example',
    },
    action: () => undefined,
    notice: null,
    problems: [],
  },
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
} satisfies Meta<typeof HostSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Filled: Story = {};
export const Saved: Story = { args: { notice: hostNotices.updated } };
export const NothingChanged: Story = {
  args: { notice: hostNotices.unchanged },
};
export const RefusedFields: Story = {
  args: {
    notice: hostNotices.invalid,
    problems: ['name', 'notificationEmail'],
  },
};
export const NothingOptionalSet: Story = {
  args: {
    values: { name: 'Quill Press', description: null, notificationEmail: null },
  },
};
