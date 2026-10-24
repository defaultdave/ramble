import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { HoldTimer } from '@/components/HoldTimer';

const now = new Date('2026-11-02T15:00:00.000Z');

function expiringIn(seconds: number): Date {
  return new Date(now.getTime() + seconds * 1000);
}

const meta = {
  title: 'Primitives/HoldTimer',
  component: HoldTimer,
  args: { now },
} satisfies Meta<typeof HoldTimer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = { args: { expiresAt: expiringIn(582) } };
export const Warning: Story = { args: { expiresAt: expiringIn(72) } };
export const Expired: Story = { args: { expiresAt: expiringIn(0) } };
