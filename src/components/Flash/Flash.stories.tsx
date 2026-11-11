import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Flash } from '@/components/Flash';
import styles from './Flash.stories.module.css';

const meta = {
  title: 'Ops/Flash',
  component: Flash,
  args: { flash: { tone: 'success', message: 'Order refunded.' } },
  decorators: [
    (Story) => (
      <div className={styles.frame}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Flash>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {};
export const Info: Story = {
  args: { flash: { tone: 'info', message: 'The refund email is queued.' } },
};
export const Warning: Story = {
  args: {
    flash: {
      tone: 'warning',
      message: 'Refunded, but the email could not send.',
    },
  },
};
export const Danger: Story = {
  args: {
    flash: {
      tone: 'danger',
      message: 'The refund did not go through. Try again.',
    },
  },
};
export const Nothing: Story = { args: { flash: null } };
