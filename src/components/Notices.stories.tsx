import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { ErrorNotice } from '@/components/ErrorNotice';
import { NotFoundNotice } from '@/components/NotFoundNotice';

// The shared 404 and error pages every route group falls back to.
const meta = {
  title: 'Pages/Notices',
  parameters: {
    a11y: {
      config: {
        // Every story renders the state twice, once per color scheme, and outside the page's main.
        rules: [
          { id: 'landmark-unique', enabled: false },
          { id: 'landmark-no-duplicate-banner', enabled: false },
        ],
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };
// Two color schemes side by side would halve the page, so a desktop story shows the light one at full width.
const fullWidth = { colorScheme: 'light' } as const;

export const NotFoundMobile: Story = {
  render: () => <NotFoundNotice />,
  globals: mobile,
};
export const NotFoundDesktop: Story = {
  render: () => <NotFoundNotice />,
  globals: desktop,
  parameters: { ...meta.parameters, ...fullWidth },
};
export const ErrorMobile: Story = {
  render: () => <ErrorNotice onRetry={fn()} />,
  globals: mobile,
};
export const ErrorDesktop: Story = {
  render: () => <ErrorNotice onRetry={fn()} />,
  globals: desktop,
  parameters: { ...meta.parameters, ...fullWidth },
};
