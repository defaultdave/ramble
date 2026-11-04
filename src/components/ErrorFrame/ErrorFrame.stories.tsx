import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ErrorFrame } from '@/components/ErrorFrame';
import { ErrorNotice } from '@/components/ErrorNotice';

const meta = {
  title: 'States/ErrorFrame',
  component: ErrorFrame,
  args: { children: <ErrorNotice onRetry={() => undefined} /> },
  parameters: {
    a11y: {
      config: {
        // Every story renders the frame twice, once per color scheme, so landmarks repeat.
        rules: [
          { id: 'landmark-no-duplicate-banner', enabled: false },
          { id: 'landmark-no-duplicate-contentinfo', enabled: false },
          { id: 'landmark-no-duplicate-main', enabled: false },
          { id: 'landmark-unique', enabled: false },
          { id: 'duplicate-id', enabled: false },
        ],
      },
    },
  },
} satisfies Meta<typeof ErrorFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mobile: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
export const Desktop: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  parameters: { ...meta.parameters, colorScheme: 'light' },
};
