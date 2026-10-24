import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Logo } from '@/components/Logo';

const meta = {
  title: 'Primitives/Logo',
  component: Logo,
} satisfies Meta<typeof Logo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
