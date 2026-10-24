import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Alert } from '@/components/Alert';

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
    title: 'Your card was declined',
    body: 'Your spaces are still held. Try another card or Apple Pay.',
    action: <button type="button">Try again</button>,
  },
};
export const WarningWithAction: Story = {
  args: {
    tone: 'warning',
    title: 'Your hold ends in 1:12',
    body: 'Finish paying to keep your spaces.',
    action: <button type="button">Pay now</button>,
  },
};
export const TitleOnly: Story = {
  args: { tone: 'info', body: undefined },
};
