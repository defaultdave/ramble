import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PageHeading } from '@/components/PageHeading';
import { deadRow, doneRow, pendingRow, retryingRow } from './OpsDev.fixtures';
import { OpsDevConsole } from './OpsDevConsole';

// One story per state: jobs in every status with the real time, a set test time, the demo clock switched off, and no jobs.

const noop = () => undefined;

const meta = {
  title: 'Ops/Test console',
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
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const consoleProps = {
  rows: [pendingRow, retryingRow, deadRow, doneRow],
  query: {},
  testTimeLabel: null,
  demoClockOn: true,
  actions: { runJob: noop, drain: noop, pulse: noop, setClock: noop },
};

export const RealTime: Story = {
  render: () => (
    <PageHeading title="Test console">
      <OpsDevConsole {...consoleProps} />
    </PageHeading>
  ),
};

export const TestTimeSet: Story = {
  render: () => (
    <PageHeading title="Test console">
      <OpsDevConsole {...consoleProps} testTimeLabel="2026-11-20 08:00 UTC" />
    </PageHeading>
  ),
};

export const DemoClockOff: Story = {
  render: () => (
    <PageHeading title="Test console">
      <OpsDevConsole {...consoleProps} demoClockOn={false} />
    </PageHeading>
  ),
};

export const NoJobs: Story = {
  render: () => (
    <PageHeading title="Test console">
      <OpsDevConsole {...consoleProps} rows={[]} />
    </PageHeading>
  ),
};
