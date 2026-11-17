import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PageHeading } from '@/components/PageHeading';
import { OpsDashboard } from './OpsDashboard';
import { auditRows, busyTiles, quietTiles } from './OpsDashboard.fixtures';

// One story per state of the landing's counts: work waiting, and nothing waiting with an empty log, each on a phone and a desktop.
const meta = {
  title: 'Ops/Dashboard',
  component: OpsDashboard,
  args: { tiles: busyTiles, recentAudit: auditRows },
  decorators: [
    (Story) => (
      <PageHeading title="Operations">
        <Story />
      </PageHeading>
    ),
  ],
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
        ],
      },
    },
  },
} satisfies Meta<typeof OpsDashboard>;

export default meta;
type Story = StoryObj<typeof meta>;

const phone = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };

export const BusyMobile: Story = { globals: phone };
export const BusyDesktop: Story = { globals: desktop };
export const QuietMobile: Story = {
  globals: phone,
  args: { tiles: quietTiles, recentAudit: [] },
};
export const QuietDesktop: Story = {
  globals: desktop,
  args: { tiles: quietTiles, recentAudit: [] },
};
