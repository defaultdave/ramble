import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { HostCancelSession } from './HostCancelSession';
import { blocked, cancelled, ready } from './HostCancelSession.fixtures';

// A host's cancellation of a booked session at its phone width: who it affects, then the confirmation.
const meta = {
  title: 'Host/HostCancelSession',
  component: HostCancelSession,
  args: {
    view: ready,
    action: () => undefined,
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
} satisfies Meta<typeof HostCancelSession>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadAndConfirm: Story = {};
export const CannotBeRefundedInFull: Story = { args: { view: blocked } };
export const AlreadyCancelled: Story = { args: { view: cancelled } };
