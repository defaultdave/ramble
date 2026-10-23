import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { Checkbox } from '@/components/Checkbox';

const meta = {
  title: 'Primitives/Checkbox',
  component: Checkbox,
  args: {
    label: 'Email me about new experiences',
    checked: false,
    onChange: fn(),
  },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {};
export const Checked: Story = { args: { checked: true } };
export const WithDescription: Story = {
  args: { description: 'One short email a week. Unsubscribe any time.' },
};
export const Error: Story = { args: { 'aria-invalid': true } };
export const Disabled: Story = { args: { disabled: true } };
export const DisabledChecked: Story = {
  args: { disabled: true, checked: true },
};
