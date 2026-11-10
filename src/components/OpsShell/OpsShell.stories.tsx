import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { opsLandingLinks, opsNavLinks } from '@/lib/opsNav';
import { OpsAccessDenied, OpsLanding, OpsNav } from './OpsShell';

// One story per state of the ops shell: the nav, the landing, and the refusal, each on a phone and a desktop.
const meta = {
  title: 'Ops/OpsShell',
  component: OpsNav,
  args: { links: opsNavLinks },
  parameters: {
    a11y: {
      config: {
        // Every story renders the component twice, once per color scheme.
        rules: [
          { id: 'landmark-unique', enabled: false },
          { id: 'duplicate-id', enabled: false },
          { id: 'landmark-banner-is-top-level', enabled: false },
          { id: 'landmark-no-duplicate-banner', enabled: false },
        ],
      },
    },
  },
} satisfies Meta<typeof OpsNav>;

export default meta;
type Story = StoryObj<typeof meta>;

const phone = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };

export const NavMobile: Story = { globals: phone };
export const NavDesktop: Story = { globals: desktop };

export const LandingMobile: Story = {
  globals: phone,
  render: () => <OpsLanding areas={opsLandingLinks()} />,
};
export const LandingDesktop: Story = {
  globals: desktop,
  render: () => <OpsLanding areas={opsLandingLinks()} />,
};

export const AccessDeniedMobile: Story = {
  globals: phone,
  render: () => <OpsAccessDenied next="/ops" />,
};
export const AccessDeniedDesktop: Story = {
  globals: desktop,
  render: () => <OpsAccessDenied next="/ops" />,
};
