import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Input } from '@/components/Input';

const meta = {
  title: 'Primitives/Input',
  component: Input,
  args: { label: 'Email', type: 'email' },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithHint: Story = {
  args: { hint: 'We send your tickets here' },
};
export const Optional: Story = { args: { label: 'Notes', optional: true } };
export const Filled: Story = { args: { defaultValue: 'sam@example.com' } };
export const Error: Story = {
  args: { defaultValue: 'sam@', errorText: 'Enter a valid email address' },
};
export const Disabled: Story = { args: { disabled: true } };
