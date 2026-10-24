import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { TimeSlot } from '@/components/TimeSlot';

const meta = {
  title: 'Primitives/TimeSlot',
  component: TimeSlot,
  args: { time: '2:00 PM', spacesLeft: 8, selected: false, onToggle: fn() },
} satisfies Meta<typeof TimeSlot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
export const FewLeft: Story = { args: { spacesLeft: 2 } };
export const SoldOut: Story = { args: { spacesLeft: 0 } };
export const Selected: Story = { args: { selected: true } };
export const SelectedFewLeft: Story = {
  args: { selected: true, spacesLeft: 2 },
};
