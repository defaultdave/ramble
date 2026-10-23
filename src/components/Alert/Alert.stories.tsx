import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';

const meta = {
  title: 'Primitives/Alert',
  component: Alert,
  args: {
    title: 'Your hold is almost up',
    body: 'Finish checking out in the next two minutes.',
  },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = { args: { tone: 'info' } };
export const Success: Story = { args: { tone: 'success' } };
export const Warning: Story = { args: { tone: 'warning' } };
export const Danger: Story = { args: { tone: 'danger' } };
export const WithAction: Story = {
  args: {
    tone: 'danger',
    action: (
      <Button variant="secondary" size="md">
        Try again
      </Button>
    ),
  },
};
export const TitleOnly: Story = {
  args: { tone: 'info', body: undefined },
};
