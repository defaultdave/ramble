import type { ComponentPropsWithoutRef } from 'react';
import { Button } from '@/components/Button';
import {
  chosenPartyLabel,
  fromPriceLabel,
  perPersonLabel,
} from '@/lib/booking';
import { SimilarLink } from './SimilarLink';
import styles from './BookingBar.module.css';

export type BookingBarState = 'default' | 'date-chosen' | 'sold-out';

type BookingBarBaseProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'className' | 'style'
>;

/** No date is chosen yet: the lowest price and the next open date. */
export type DefaultBookingBarProps = BookingBarBaseProps & {
  state?: 'default';
  /** Integer minor units, the lowest per-person price. */
  priceMinor: number;
  /** For example "Sat, Oct 24". Left out when the next date is not known. */
  nextDate?: string;
  onChooseDate: () => void;
};

/** A date, time, and party are chosen; Continue places the hold. */
export type DateChosenBookingBarProps = BookingBarBaseProps & {
  state: 'date-chosen';
  /** For example "Sat, Oct 24 · 2:00 PM". */
  when: string;
  guests: number;
  /** Integer minor units, the amount charged. */
  totalMinor: number;
  loading?: boolean;
  onContinue: () => void;
};

/** No date has spaces: the bar points to other experiences instead. */
export type SoldOutBookingBarProps = BookingBarBaseProps & {
  state: 'sold-out';
  similarHref: string;
};

export type BookingBarProps =
  DefaultBookingBarProps | DateChosenBookingBarProps | SoldOutBookingBarProps;

// TODO(U-041): first caller, the experience page, which shows it on phones and the panel from 768px.
export function BookingBar(props: BookingBarProps) {
  if (props.state === 'date-chosen') {
    const {
      state,
      when,
      guests,
      totalMinor,
      loading = false,
      onContinue,
      ...rest
    } = props;
    return (
      <div {...rest} className={styles.bar} data-state={state}>
        <BarText
          primary={when}
          secondary={chosenPartyLabel(guests, totalMinor)}
        />
        <Button loading={loading} onClick={onContinue}>
          Continue
        </Button>
      </div>
    );
  }
  if (props.state === 'sold-out') {
    const { state, similarHref, ...rest } = props;
    return (
      <div {...rest} className={styles.bar} data-state={state}>
        <BarText
          primary="No open dates"
          secondary="New dates are added weekly"
        />
        <SimilarLink href={similarHref} size="md" />
      </div>
    );
  }
  const {
    state = 'default',
    priceMinor,
    nextDate,
    onChooseDate,
    ...rest
  } = props;
  return (
    <div {...rest} className={styles.bar} data-state={state}>
      <BarText
        primary={fromPriceLabel(priceMinor)}
        secondary={perPersonLabel(nextDate)}
      />
      <Button onClick={onChooseDate}>Choose date</Button>
    </div>
  );
}

function BarText({
  primary,
  secondary,
}: {
  primary: string;
  secondary: string;
}) {
  return (
    <p className={styles.text}>
      <span className={styles.primary}>{primary}</span>{' '}
      <span className={styles.secondary}>{secondary}</span>
    </p>
  );
}
