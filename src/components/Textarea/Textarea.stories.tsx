import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Textarea } from '@/components/Textarea';

const meta = {
  title: 'Ops/Textarea',
  component: Textarea,
  args: {
    label: 'Note to the guest',
    name: 'note',
    defaultValue: 'The host had to cancel because of a storm.',
    maxLength: 500,
  },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

const hint = 'Up to 500 characters.';

export const Default: Story = { args: { hint } };
export const WithoutHint: Story = {};
export const Empty: Story = {
  args: { defaultValue: '', placeholder: 'What should the guest know?', hint },
};
export const Focus: Story = {
  args: { hint },
  play: async ({ userEvent }) => {
    await userEvent.tab();
  },
};
export const Optional: Story = { args: { optional: true, defaultValue: '' } };
export const Error: Story = {
  args: { defaultValue: '', hint, errorText: 'Write a note before sending.' },
};
export const Disabled: Story = { args: { hint, disabled: true } };
