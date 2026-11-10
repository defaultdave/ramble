import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { AccessibilityStatement } from './AccessibilityStatement';

const meta = {
  title: 'Help/AccessibilityStatement',
  component: AccessibilityStatement,
  parameters: {
    a11y: {
      config: {
        // Every story renders the page twice, once per color scheme.
        rules: [
          { id: 'landmark-unique', enabled: false },
          { id: 'duplicate-id', enabled: false },
          { id: 'duplicate-id-aria', enabled: false },
        ],
      },
    },
  },
} satisfies Meta<typeof AccessibilityStatement>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mobile: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
