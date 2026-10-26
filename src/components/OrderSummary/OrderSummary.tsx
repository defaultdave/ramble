import { ChevronDown } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { useId } from 'react';
import {
  bookingMeta,
  giftMeta,
  orderSummaryAmounts,
  type OrderSummaryLine,
  type TaxTreatment,
} from '@/lib/orderSummary';
import styles from './OrderSummary.module.css';

export type OrderSummaryKind = 'booking' | 'gift';

type OrderSummaryBaseProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'title' | 'children' | 'className' | 'style'
> & {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  /** The experience photo; the frame shows its sunken fill without one. */
  thumbnail?: ReactNode;
  /** The neighborhood and meeting note under the photo. */
  where: string;
  /** One line per price option, for example "$85 × 2 guests". */
  lines: readonly OrderSummaryLine[];
  /** Decides whether the tax line shows (PRD-78); the amount below is shown only for a taxable experience. */
  taxTreatment: TaxTreatment;
  /** Integer minor units; 0 unless the experience is taxable. */
  taxMinor: number;
  /** Integer minor units; the amount charged, which the lines and tax must add up to. */
  totalMinor: number;
  /** The cancellation or validity line under the total. */
  terms: string;
};

export type BookingOrderSummaryProps = OrderSummaryBaseProps & {
  kind?: 'booking';
  dateLabel: string;
  timeLabel: string;
  guests: number;
};

export type GiftOrderSummaryProps = OrderSummaryBaseProps & {
  kind: 'gift';
  recipientName: string;
  deliveryLabel: string;
};

export type OrderSummaryProps =
  BookingOrderSummaryProps | GiftOrderSummaryProps;

// TODO(U-047b): first caller, the checkout page; the confirmation page follows in U-048.
export function OrderSummary(props: OrderSummaryProps) {
  if (props.kind === 'gift') {
    const { kind, recipientName, deliveryLabel, ...shell } = props;
    return (
      <Shell
        {...shell}
        kind={kind}
        meta={giftMeta({ recipientName, deliveryLabel })}
      />
    );
  }
  const { kind = 'booking', dateLabel, timeLabel, guests, ...shell } = props;
  return (
    <Shell
      {...shell}
      kind={kind}
      meta={bookingMeta({ dateLabel, timeLabel, guests })}
    />
  );
}

type ShellProps = OrderSummaryBaseProps & {
  kind: OrderSummaryKind;
  meta: string;
};

function Shell({
  kind,
  meta,
  title,
  expanded,
  onToggle,
  thumbnail,
  where,
  lines,
  taxTreatment,
  taxMinor,
  totalMinor,
  terms,
  ...rest
}: ShellProps) {
  const detailsId = useId();
  const amounts = orderSummaryAmounts({
    lines,
    taxTreatment,
    taxMinor,
    totalMinor,
  });

  return (
    <div {...rest} className={styles.summary} data-kind={kind}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={onToggle}
      >
        <span className={styles.text}>
          <span className={styles.title}>{title}</span>{' '}
          <span className={styles.meta}>{meta}</span>
        </span>{' '}
        <span className={styles.total}>{amounts.total}</span>{' '}
        {expanded ? (
          <span className={styles.hide}>Hide</span>
        ) : (
          <ChevronDown className={styles.chevron} aria-hidden="true" />
        )}
      </button>
      <div id={detailsId} className={styles.details} hidden={!expanded}>
        <div className={styles.item}>
          <div className={styles.thumbnail}>{thumbnail}</div>
          <p className={styles.where}>{where}</p>
        </div>
        <hr className={styles.divider} />
        <dl className={styles.lines}>
          {amounts.lines.map((line) => (
            <div key={line.label} className={styles.line}>
              <dt className={styles.lineLabel}>{line.label}</dt>
              <dd className={styles.lineAmount}>{line.amount}</dd>
            </div>
          ))}
          {amounts.tax ? (
            <div className={styles.line}>
              <dt className={styles.lineLabel}>{amounts.tax.label}</dt>
              <dd className={styles.lineAmount}>{amounts.tax.amount}</dd>
            </div>
          ) : null}
        </dl>
        <hr className={styles.divider} />
        <dl className={styles.lines}>
          <div className={styles.totalLine}>
            <dt>Total charged</dt>
            <dd className={styles.totalAmount}>{amounts.total}</dd>
          </div>
        </dl>
        <p className={styles.terms}>{terms}</p>
      </div>
    </div>
  );
}
