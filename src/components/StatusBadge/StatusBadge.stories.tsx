import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { StatusBadge } from '@/components/StatusBadge';

const meta = {
  title: 'Ops/StatusBadge',
  component: StatusBadge,
  args: { tone: 'success', label: 'Paid' },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {};
export const Warning: Story = { args: { tone: 'warning', label: 'Pending' } };
export const Danger: Story = { args: { tone: 'danger', label: 'Failed' } };
export const Info: Story = {
  args: { tone: 'info', label: 'Refund requested' },
};
export const Neutral: Story = { args: { tone: 'neutral', label: 'Draft' } };
