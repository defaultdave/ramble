import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Select } from '@/components/Select';

const meta = {
  title: 'Ops/Select',
  component: Select,
  args: {
    label: 'Refund reason',
    name: 'reason',
    defaultValue: 'weather',
    options: [
      { value: 'weather', label: 'Weather' },
      { value: 'host', label: 'Host cancelled' },
      { value: 'duplicate', label: 'Duplicate booking' },
      { value: 'other', label: 'Other', disabled: true },
    ],
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

const hint = 'Shown to the guest in the refund email.';

export const Default: Story = { args: { hint } };
export const WithoutHint: Story = {};
export const Placeholder: Story = {
  args: { placeholder: 'Choose a reason', defaultValue: '', hint },
};
export const Focus: Story = {
  args: { hint },
  play: async ({ userEvent }) => {
    await userEvent.tab();
  },
};
export const Optional: Story = { args: { optional: true } };
export const Error: Story = {
  args: {
    placeholder: 'Choose a reason',
    defaultValue: '',
    hint,
    errorText: 'Choose a reason.',
  },
};
export const Disabled: Story = { args: { hint, disabled: true } };
