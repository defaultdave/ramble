import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import {
  BookingBar,
  type DateChosenBookingBarProps,
  type DefaultBookingBarProps,
  type SoldOutBookingBarProps,
} from '@/components/BookingBar';
import styles from './BookingBar.stories.module.css';

const meta = {
  title: 'Composites/BookingBar',
  component: BookingBar,
  decorators: [
    (Story) => (
      <div className={styles.frame}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BookingBar>;

export default meta;

// BookingBar is a union on state, which Storybook cannot infer args from, so each story names its props.
type DefaultStory = StoryObj<DefaultBookingBarProps>;
type DateChosenStory = StoryObj<DateChosenBookingBarProps>;
type SoldOutStory = StoryObj<SoldOutBookingBarProps>;

const defaults = {
  priceMinor: 8500,
  nextDate: 'Sat, Oct 24',
  onChooseDate: fn(),
} satisfies DefaultBookingBarProps;

const chosen = {
  state: 'date-chosen',
  when: 'Sat, Oct 24 · 2:00 PM',
  guests: 2,
  totalMinor: 17000,
  onContinue: fn(),
} satisfies DateChosenBookingBarProps;

export const Default: DefaultStory = { args: defaults };
export const DefaultWithoutNextDate: DefaultStory = {
  args: { priceMinor: 8500, onChooseDate: fn() },
};
export const DefaultCentsPrice: DefaultStory = {
  args: { ...defaults, priceMinor: 6550 },
};
export const DateChosen: DateChosenStory = { args: chosen };
export const DateChosenOneGuest: DateChosenStory = {
  args: { ...chosen, guests: 1, totalMinor: 8500 },
};
export const DateChosenPlacingHold: DateChosenStory = {
  args: { ...chosen, loading: true },
};
export const SoldOut: SoldOutStory = {
  args: { state: 'sold-out', similarHref: '/browse?like=hand-rolled-pasta' },
};
