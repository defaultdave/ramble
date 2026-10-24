import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Illustration } from '@/components/Illustration';

const meta = {
  title: 'Primitives/Illustration',
  component: Illustration,
} satisfies Meta<typeof Illustration>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Large: Story = { args: { width: 320, height: 240 } };
