import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { HoldTimer } from '@/components/HoldTimer';

const meta = {
  title: 'Primitives/HoldTimer',
  component: HoldTimer,
} satisfies Meta<typeof HoldTimer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = { args: { secondsRemaining: 582 } };
export const Warning: Story = { args: { secondsRemaining: 72 } };
export const Expired: Story = { args: { secondsRemaining: 0 } };
