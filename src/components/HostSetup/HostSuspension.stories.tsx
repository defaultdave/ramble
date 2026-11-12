import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ActionNotice } from '@/components/ActionNotice';
import { PageHeading } from '@/components/PageHeading';
import { pauseNoticeFor } from '@/lib/experiencePause';
import { HostSuspension } from './HostSuspension';

// One story per state of the suspension control: live experiences to pause, experiences a suspension paused, both, neither, and the notice after a suspension, on a phone and a desktop.
const noop = () => undefined;

const meta = {
  title: 'Ops/HostSuspension',
  component: HostSuspension,
  args: {
    hostId: '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    suspension: { liveCount: 3, suspendedCount: 0 },
    suspend: noop,
    unsuspend: noop,
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
      <PageHeading title="Spoke & Saddle">
        <Story />
      </PageHeading>
    ),
  ],
} satisfies Meta<typeof HostSuspension>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };

export const LiveExperiencesMobile: Story = { globals: mobile };
export const LiveExperiencesDesktop: Story = { globals: desktop };
export const SuspendedMobile: Story = {
  globals: mobile,
  args: { suspension: { liveCount: 0, suspendedCount: 2 } },
};
export const BothMobile: Story = {
  globals: mobile,
  args: { suspension: { liveCount: 1, suspendedCount: 2 } },
};
export const NothingToDoDesktop: Story = {
  globals: desktop,
  args: { suspension: { liveCount: 0, suspendedCount: 0 } },
};
export const SuspendedNoticeMobile: Story = {
  globals: mobile,
  args: { suspension: { liveCount: 0, suspendedCount: 2 } },
  render: (args) => (
    <>
      <ActionNotice notice={pauseNoticeFor('suspended')} />
      <HostSuspension {...args} />
    </>
  ),
};
