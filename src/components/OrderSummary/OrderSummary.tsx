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
  /**
   * Opt in to a summary that is open by itself from the tablet width (768px), by CSS alone. From
   * there the toggle is out of the page's accessibility tree and tab order and the title shows as
   * a plain heading; below it the toggle works as usual.
   */
  openFrom?: 'tablet';
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
  openFrom,
  ...rest
}: ShellProps) {
  const baseId = useId();
  const detailsId = `${baseId}-details`;
  const titleId = `${baseId}-title`;
  const metaId = `${baseId}-meta`;
  const totalId = `${baseId}-total`;
  const hideId = `${baseId}-hide`;
  const amounts = orderSummaryAmounts({
    lines,
    taxTreatment,
    taxMinor,
    totalMinor,
  });

  return (
    <div
      {...rest}
      className={styles.summary}
      data-kind={kind}
      data-open-from={openFrom}
    >
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={expanded}
        aria-controls={detailsId}
        // Named from its visible parts, spelled out so every tool reads a name; "Hide" stays in it while shown (WCAG 2.5.3), and aria-expanded carries the state.
        aria-labelledby={
          expanded
            ? `${titleId} ${metaId} ${totalId} ${hideId}`
            : `${titleId} ${metaId} ${totalId}`
        }
        onClick={onToggle}
      >
        <span className={styles.text}>
          <span id={titleId} className={styles.title}>
            {title}
          </span>{' '}
          <span id={metaId} className={styles.meta}>
            {meta}
          </span>
        </span>{' '}
        <span id={totalId} className={styles.total}>
          {amounts.total}
        </span>{' '}
        {expanded ? (
          <span id={hideId} className={styles.hide}>
            Hide
          </span>
        ) : (
          <ChevronDown className={styles.chevron} aria-hidden="true" />
        )}
      </button>
      {openFrom ? (
        <div className={styles.fixedHead}>
          <span className={styles.text}>
            <h2 className={styles.fixedTitle}>{title}</h2>
            <span className={styles.meta}>{meta}</span>
          </span>
          <span className={styles.total}>{amounts.total}</span>
        </div>
      ) : null}
      <div id={detailsId} className={styles.details} hidden={!expanded}>
        <div className={styles.item}>
          <div className={styles.thumbnail}>{thumbnail}</div>
          <p className={styles.where}>{where}</p>
        </div>
        <hr className={styles.divider} />
        <dl className={styles.lines}>
          {amounts.lines.map((line, index) => (
            <div key={`${String(index)}-${line.label}`} className={styles.line}>
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
            <dt className={styles.totalLabel}>Total charged</dt>
            <dd className={styles.totalAmount}>{amounts.total}</dd>
          </div>
        </dl>
        <p className={styles.terms}>{terms}</p>
      </div>
    </div>
  );
}
