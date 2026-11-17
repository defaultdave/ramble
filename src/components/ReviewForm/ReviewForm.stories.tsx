import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import type { ReviewScreen, ReviewSummary } from '@/lib/reviews';
import { ReviewForm } from './ReviewForm';

// One story per state the review page can open to: the form, the form after a failed submit, the
// the form again with what was typed kept, the invalid link, an already reviewed booking, a closed window, success, and too many tries.

const summary: ReviewSummary = {
  experienceName: 'Sunset kayak on the Hudson',
  hostName: 'Hudson Paddle Club',
  dayLabel: 'Sunday, November 15, 2026',
};

const meta = {
  title: 'Post-booking/Review form',
  component: ReviewForm,
  parameters: { layout: 'fullscreen' },
  args: {
    screen: { kind: 'form', problems: [] } satisfies ReviewScreen,
    summary,
    draft: null,
    reference: 'RMB-7K3M9Q',
    token: 'A'.repeat(43),
    action: fn(),
  },
} satisfies Meta<typeof ReviewForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Form: Story = {};

export const FormAfterAFailedSubmit: Story = {
  args: { screen: { kind: 'form', problems: ['rating', 'body'] } },
};

export const FormAfterAFailedSubmitKeepsWhatWasTyped: Story = {
  args: {
    screen: { kind: 'form', problems: ['body'] },
    draft: { reference: 'RMB-7K3M9Q', rating: 4, body: '   ' },
  },
};

export const InvalidLink: Story = {
  args: { screen: { kind: 'invalid' }, summary: null },
};

export const AlreadyReviewed: Story = {
  args: { screen: { kind: 'already_reviewed' } },
};

export const Expired: Story = { args: { screen: { kind: 'expired' } } };

export const Success: Story = { args: { screen: { kind: 'success' } } };

export const TooManyTries: Story = {
  args: {
    screen: { kind: 'too_many_tries', retryAfterSeconds: 42 },
    summary: null,
  },
};
