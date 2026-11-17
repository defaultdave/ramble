import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ActionNotice } from '@/components/ActionNotice';
import { PageHeading } from '@/components/PageHeading';
import { settingsNotices } from '@/lib/opsSettings';
import { OpsSettings } from './OpsSettings';

// One story per state of the settings page at the phone width: stored values, a saved notice, refused fields, and no paused experience.
const meta = {
  title: 'Ops/OpsSettings',
  component: OpsSettings,
  args: {
    values: {
      bannerText: 'Closed Monday for the holiday.',
      bookingsPaused: false,
      holdMinutes: '10',
      paymentGraceMinutes: '5',
      checkoutMaintenance: false,
      taxRatePercent: '8.875',
    },
    action: () => undefined,
    problems: [],
    paused: {
      rows: [
        {
          id: 'e1',
          name: 'Sunrise Kayak on the Hudson',
          hostName: 'Spoke & Saddle',
          href: '/ops/experiences/e1',
        },
        {
          id: 'e2',
          name: 'Letterpress Workshop',
          hostName: 'Quill Press',
          href: '/ops/experiences/e2',
        },
      ],
      moreHref: null,
    },
    tiers: [
      {
        id: 't1',
        name: 'Flexible',
        terms: 'Free cancellation up to 24 hours before',
        isDefault: true,
      },
      {
        id: 't2',
        name: 'Moderate',
        terms: 'Free cancellation up to 3 days before',
        isDefault: false,
      },
      {
        id: 't3',
        name: 'Strict',
        terms: 'Free cancellation up to 7 days before',
        isDefault: false,
      },
    ],
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
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  decorators: [
    (Story, { args }) => (
      <>
        <PageHeading title="Settings">
          <ActionNotice
            notice={args.problems.length > 0 ? settingsNotices.invalid : null}
          />
        </PageHeading>
        <Story />
      </>
    ),
  ],
} satisfies Meta<typeof OpsSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Stored: Story = {};
export const BookingsPausedAndMaintenance: Story = {
  args: {
    values: {
      bannerText: '',
      bookingsPaused: true,
      holdMinutes: '15',
      paymentGraceMinutes: '0',
      checkoutMaintenance: true,
      taxRatePercent: '0',
    },
  },
};
export const RefusedFields: Story = {
  args: { problems: ['holdMinutes', 'taxRatePercent'] },
};
export const NothingPaused: Story = {
  args: { paused: { rows: [], moreHref: null } },
};
export const MorePausedThanListed: Story = {
  args: {
    paused: {
      rows: [
        {
          id: 'e1',
          name: 'Sunrise Kayak on the Hudson',
          hostName: 'Spoke & Saddle',
          href: '/ops/experiences/e1',
        },
      ],
      moreHref: '/ops/experiences?status=paused',
    },
  },
};
