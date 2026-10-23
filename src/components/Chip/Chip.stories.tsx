import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Sun } from 'lucide-react';
import { fn } from 'storybook/test';
import { Chip } from '@/components/Chip';

const meta = {
  title: 'Primitives/Chip',
  component: Chip,
  args: { label: 'Outdoor', selected: false, onToggle: fn() },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Selected: Story = { args: { selected: true } };
export const WithCount: Story = { args: { count: 24 } };
export const WithIconStart: Story = { args: { iconStart: <Sun /> } };
export const SelectedWithCount: Story = {
  args: { selected: true, count: 24 },
};
export const Disabled: Story = { args: { disabled: true } };
