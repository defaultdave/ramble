import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { reviewsView } from '@/lib/reviewList';
import { ReviewsBlock } from './ReviewsBlock';
import { reviewRows, reviewsFixture } from './ReviewsBlock.fixtures';
import styles from './ReviewsBlock.stories.module.css';

// The reviews block as the page draws it under its "Reviews" heading, once an experience has five or more reviews.
const meta = {
  title: 'Experience/ReviewsBlock',
  component: ReviewsBlock,
  args: { view: reviewsFixture },
  decorators: [
    (Story) => (
      <div className={styles.frame}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReviewsBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Twelve reviews, the newest ten listed. */
export const TwelveReviews: Story = {};

const atThreshold = reviewsView(
  { average: 5, count: 5 },
  reviewRows.slice(0, 5),
);
if (atThreshold === null) throw new Error('Five reviews is the threshold');

/** Exactly five, the least that shows. */
export const AtTheThreshold: Story = { args: { view: atThreshold } };

const longWords = reviewsView(
  { average: 3.8, count: 6 },
  reviewRows.slice(0, 6).map((row, index) =>
    index === 0
      ? {
          ...row,
          guestName: `${'Wolfeschlegelsteinhausenbergerdorff'.repeat(2)} Smith`,
          body: `${'A long unbroken word '.repeat(2)}${'x'.repeat(120)}\n\nA second paragraph that wraps over several lines on a phone, to see that the rhythm of the list holds.`,
        }
      : row,
  ),
);
if (longWords === null) throw new Error('Six reviews is over the threshold');

/** A long name and a long unbroken word wrap inside the column. */
export const LongText: Story = { args: { view: longWords } };
