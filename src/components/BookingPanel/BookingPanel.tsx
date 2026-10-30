import Link from 'next/link';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { SimilarLink } from '@/components/BookingBar/SimilarLink';
import { continueLabel, pausedNotice } from '@/lib/booking';
import { formatMoney } from '@/lib/money';
import { perPersonAmount } from '@/lib/pricing';
import styles from './BookingPanel.module.css';

type BookingPanelBaseProps = Omit<
  ComponentPropsWithoutRef<'section'>,
  'children' | 'className' | 'style'
> & {
  /** Integer minor units, the per-person price. */
  priceMinor: number;
};

export type DefaultBookingPanelProps = BookingPanelBaseProps & {
  state?: 'default';
  /** The book or gift switch, left out while gifts are off. */
  mode?: ReactNode;
  /** The date, time, and party choices. */
  children: ReactNode;
  /** Left out until a date and party are chosen; Continue stays disabled without it. */
  total?: {
    /** For example "$65 × 2 guests". */
    label: string;
    /** Integer minor units, the amount charged. */
    amountMinor: number;
    /** The cancellation line under the total. */
    terms?: string;
  };
  /** The line under Continue, for example how long spaces are held. */
  holdNote?: string;
  loading?: boolean;
  onContinue: () => void;
};

/** No date has spaces: the panel points to other experiences instead of offering choices. */
export type SoldOutBookingPanelProps = BookingPanelBaseProps & {
  state: 'sold-out';
  similarHref: string;
  /** Where "Ask about a private session" goes. */
  privateSessionHref: string;
};

/** Ops paused bookings: the panel says so in place of the choices. */
export type PausedBookingPanelProps = BookingPanelBaseProps & {
  state: 'paused';
};

export type BookingPanelProps =
  DefaultBookingPanelProps | SoldOutBookingPanelProps | PausedBookingPanelProps;

export function BookingPanel(props: BookingPanelProps) {
  if (props.state === 'paused') {
    const { state, priceMinor, ...rest } = props;
    return (
      <Shell {...rest} state={state} priceMinor={priceMinor}>
        <Alert
          tone="info"
          title={pausedNotice.title}
          body={pausedNotice.body}
        />
      </Shell>
    );
  }
  if (props.state === 'sold-out') {
    const { state, priceMinor, similarHref, privateSessionHref, ...rest } =
      props;
    return (
      <Shell {...rest} state={state} priceMinor={priceMinor}>
        <Alert
          tone="info"
          title="No open dates right now"
          body="The host adds new dates every week. See similar experiences, or ask about a private session."
        />
        <div className={styles.action}>
          <SimilarLink
            href={similarHref}
            size="lg"
            label="See similar experiences"
          />
        </div>
        <Link href={privateSessionHref} className={styles.privateLink}>
          Ask about a private session
        </Link>
      </Shell>
    );
  }
  const {
    state = 'default',
    priceMinor,
    mode,
    children,
    total,
    holdNote,
    loading = false,
    onContinue,
    ...rest
  } = props;
  return (
    <Shell {...rest} state={state} priceMinor={priceMinor}>
      {mode ? <div className={styles.mode}>{mode}</div> : null}
      {children}
      {total ? (
        <>
          <hr className={styles.divider} />
          <dl className={styles.total}>
            <div className={styles.totalLine}>
              <dt className={styles.totalLabel}>{total.label}</dt>
              <dd className={styles.totalAmount}>
                {formatMoney(total.amountMinor)}
              </dd>
            </div>
          </dl>
          {total.terms ? <p className={styles.note}>{total.terms}</p> : null}
        </>
      ) : null}
      <div className={styles.action}>
        <Button
          size="lg"
          disabled={!total}
          loading={loading}
          onClick={onContinue}
        >
          {total ? continueLabel(total.amountMinor) : 'Continue'}
        </Button>
      </div>
      {holdNote ? <p className={styles.note}>{holdNote}</p> : null}
    </Shell>
  );
}

function Shell({
  state,
  priceMinor,
  children,
  ...rest
}: BookingPanelBaseProps & {
  state: 'default' | 'sold-out' | 'paused';
  children: ReactNode;
}) {
  return (
    <section
      aria-label="Book this experience"
      {...rest}
      className={styles.panel}
      data-state={state}
    >
      <p className={styles.price}>
        <span className={styles.priceAmount}>
          {perPersonAmount(priceMinor)}
        </span>{' '}
        <span className={styles.priceUnit}>per person</span>
      </p>
      {children}
    </section>
  );
}
