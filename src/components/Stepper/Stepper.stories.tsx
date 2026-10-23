import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { Stepper } from '@/components/Stepper';

const meta = {
  title: 'Primitives/Stepper',
  component: Stepper,
  args: { label: 'Adults', value: 2, min: 1, max: 6, onChange: fn() },
} satisfies Meta<typeof Stepper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithHint: Story = { args: { hint: 'Ages 13 and up' } };
export const AtMin: Story = { args: { value: 1 } };
export const AtMax: Story = { args: { value: 6 } };
export const Disabled: Story = { args: { disabled: true } };
