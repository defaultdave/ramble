import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Trees } from 'lucide-react';
import { fn } from 'storybook/test';
import { Badge } from '@/components/Badge';
import { BookingSheet } from '@/components/BookingSheet';
import { Button } from '@/components/Button';
import { DatePicker } from '@/components/DatePicker';
import { Stepper } from '@/components/Stepper';
import styles from './BookingSheet.stories.module.css';

// The sheet is a slot shell; this content only fills it for the story.
const content = (
  <div className={styles.content}>
    <h3 className={styles.heading}>Pick a date</h3>
    <DatePicker
      label="Choose a date"
      value="2026-10-24"
      today="2026-10-18"
      availableDates={['2026-10-22', '2026-10-24', '2026-10-25']}
      onChange={fn()}
    />
    <h3 className={styles.heading}>Who&apos;s coming</h3>
    <Stepper
      label="Guests"
      hint="Ages 14 and up · up to 6 per booking"
      value={2}
      min={1}
      max={6}
      onChange={fn()}
    />
  </div>
);

const footer = (
  <div className={styles.footer}>
    <div className={styles.total}>
      <span>$65 × 2 guests</span>
      <strong>$130.00</strong>
    </div>
    <Button size="lg">Continue · $130.00</Button>
  </div>
);

const meta = {
  title: 'Composites/BookingSheet',
  component: BookingSheet,
  args: {
    open: true,
    title: 'Sunset kayak on the Hudson',
    eyebrow: <Badge tone="green" label="Outdoor" icon={<Trees />} />,
    children: content,
    footer,
    onClose: fn(),
  },
} satisfies Meta<typeof BookingSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

// An open overlay covers the page, so each scheme gets its own story.
export const Light: Story = { parameters: { colorScheme: 'light' } };
export const Dark: Story = { parameters: { colorScheme: 'dark' } };
