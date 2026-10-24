import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Input } from '@/components/Input';

const meta = {
  title: 'Primitives/Input',
  component: Input,
  args: {
    label: 'Email',
    type: 'email',
    defaultValue: 'alex@example.com',
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

const hint = 'We send your booking here.';

export const Default: Story = { args: { hint } };
export const WithoutHint: Story = {};
export const Focus: Story = {
  args: { hint },
  play: async ({ userEvent }) => {
    await userEvent.tab();
  },
};
export const Optional: Story = {
  args: { label: 'Notes', optional: true, type: 'text', defaultValue: '' },
};
export const Error: Story = {
  args: { hint, errorText: 'Enter an email like name@example.com.' },
};
export const Disabled: Story = { args: { hint, disabled: true } };
