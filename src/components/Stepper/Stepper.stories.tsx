import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { Stepper } from '@/components/Stepper';

const meta = {
  title: 'Primitives/Stepper',
  component: Stepper,
  args: {
    label: 'Adults',
    value: 2,
    min: 1,
    max: 6,
    onChange: fn(),
  },
} satisfies Meta<typeof Stepper>;

export default meta;
type Story = StoryObj<typeof meta>;

const hint = 'Up to 6 per booking';

export const Default: Story = { args: { hint } };
export const WithoutHint: Story = {};
export const AtMin: Story = { args: { hint, value: 1 } };
export const AtMax: Story = { args: { hint, value: 6 } };
export const Disabled: Story = { args: { hint, disabled: true } };
