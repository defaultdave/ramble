import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Gift } from 'lucide-react';
import { fn } from 'storybook/test';
import { Chip } from '@/components/Chip';
import { DatePicker } from '@/components/DatePicker';
import { Stepper } from '@/components/Stepper';
import { TimeSlot } from '@/components/TimeSlot';
import {
  BookingPanel,
  type DefaultBookingPanelProps,
  type SoldOutBookingPanelProps,
} from '@/components/BookingPanel';
import styles from './BookingPanel.stories.module.css';

const meta = {
  title: 'Composites/BookingPanel',
  component: BookingPanel,
  parameters: {
    a11y: {
      config: {
        // Every story renders the component twice, once per color scheme, so the region repeats.
        rules: [{ id: 'landmark-unique', enabled: false }],
      },
    },
  },
  decorators: [
    (Story) => (
      <div className={styles.frame}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BookingPanel>;

export default meta;

// BookingPanel is a union on state, which Storybook cannot infer args from, so each story names its props.
type DefaultStory = StoryObj<DefaultBookingPanelProps>;
type SoldOutStory = StoryObj<SoldOutBookingPanelProps>;

const mode = (
  <>
    <Chip selected label="Book for me" onToggle={fn()} />
    <Chip
      selected={false}
      label="Give as a gift"
      iconStart={<Gift />}
      onToggle={fn()}
    />
  </>
);

// The panel is a slot shell; these choices only fill it for the story.
const choices = (
  <>
    <h3 className={styles.heading}>Pick a date</h3>
    <DatePicker
      label="Choose a date"
      value="2026-10-24"
      today="2026-10-18"
      availableDates={['2026-10-22', '2026-10-24', '2026-10-25', '2026-10-29']}
      onChange={fn()}
    />
    <h3 className={styles.heading}>Time on Sat, Oct 24</h3>
    <div className={styles.times}>
      <TimeSlot
        time="4:00 PM"
        spacesLeft={10}
        selected={false}
        onToggle={fn()}
      />
      <TimeSlot time="5:30 PM" spacesLeft={8} selected onToggle={fn()} />
      <TimeSlot
        time="7:00 PM"
        spacesLeft={0}
        selected={false}
        onToggle={fn()}
      />
    </div>
    <Stepper
      label="Guests"
      hint="Ages 14 and up · up to 6 per booking"
      value={2}
      min={1}
      max={6}
      onChange={fn()}
    />
  </>
);

const defaults = {
  priceMinor: 6500,
  mode,
  children: choices,
  holdNote: 'We hold your spaces for 10 minutes while you pay.',
  onContinue: fn(),
} satisfies DefaultBookingPanelProps;

const total = {
  label: '$65 × 2 guests',
  amountMinor: 13000,
  terms: 'Free cancellation until Fri, Oct 23, 5:30 PM.',
};

export const DateChosen: DefaultStory = { args: { ...defaults, total } };
export const NothingChosenYet: DefaultStory = { args: defaults };
export const PlacingHold: DefaultStory = {
  args: { ...defaults, total, loading: true },
};
export const SoldOut: SoldOutStory = {
  args: {
    state: 'sold-out',
    priceMinor: 6500,
    similarHref: '/browse?like=hand-rolled-pasta',
  },
};
