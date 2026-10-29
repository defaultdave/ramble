import Link from 'next/link';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { SimilarLink } from '@/components/BookingBar/SimilarLink';
import { continueLabel } from '@/lib/booking';
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
  /** The book or gift switch. */
  mode: ReactNode;
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
  // TODO(U-041): first caller; the private-session request page the link opens comes from its own unit.
  /** Where "Ask about a private session" goes. */
  privateSessionHref: string;
};

export type BookingPanelProps =
  DefaultBookingPanelProps | SoldOutBookingPanelProps;

// TODO(U-041): first caller, the experience page, which shows it from 768px and the bar below that.
export function BookingPanel(props: BookingPanelProps) {
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
      <div className={styles.mode}>{mode}</div>
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
  state: 'default' | 'sold-out';
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
