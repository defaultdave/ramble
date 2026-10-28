import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { GuestShell, SiteBanner } from '@/components/GuestShell';

const meta = {
  title: 'Home/GuestShell',
  component: GuestShell,
  args: { children: <p>The page goes here.</p> },
  parameters: {
    a11y: {
      config: {
        // Every story renders the shell twice, once per color scheme, so landmarks repeat.
        rules: [
          { id: 'landmark-no-duplicate-banner', enabled: false },
          { id: 'landmark-no-duplicate-contentinfo', enabled: false },
          { id: 'landmark-no-duplicate-main', enabled: false },
          { id: 'landmark-unique', enabled: false },
          { id: 'duplicate-id', enabled: false },
          { id: 'page-has-heading-one', enabled: false },
        ],
      },
    },
  },
} satisfies Meta<typeof GuestShell>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };
// Two color schemes side by side would halve the page, so a desktop story shows the light one at full width.
const fullWidth = { colorScheme: 'light' } as const;

export const Mobile: Story = { globals: mobile };
export const Desktop: Story = {
  globals: desktop,
  parameters: { ...meta.parameters, ...fullWidth },
};
export const WithBannerMobile: Story = {
  args: {
    banner: (
      <SiteBanner text="Closed Monday for weather. Everything else is on." />
    ),
  },
  globals: mobile,
};
export const WithBannerDesktop: Story = {
  args: {
    banner: (
      <SiteBanner text="Closed Monday for weather. Everything else is on." />
    ),
  },
  globals: desktop,
  parameters: { ...meta.parameters, ...fullWidth },
};
