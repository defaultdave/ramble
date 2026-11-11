import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { HostSessionFormState } from '@/lib/hostSessions';
import { HostSessions } from './HostSessions';
import { emptyWeek, week } from './HostSessions.fixtures';

const saved = (): Promise<HostSessionFormState> =>
  Promise.resolve({ status: 'done', message: 'Saved.' });

// The host's week at its phone width: sessions by day, each with its edit forms, then the one-off form.
const meta = {
  title: 'Host/HostSessions',
  component: HostSessions,
  args: {
    view: week,
    actions: {
      publishWeek: saved,
      updateCapacity: saved,
      updateTime: saved,
      updatePrice: saved,
      cancelSession: saved,
      addOneOff: saved,
    },
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
} satisfies Meta<typeof HostSessions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AWeekOfSessions: Story = {};
export const NothingThisWeek: Story = { args: { view: emptyWeek } };
