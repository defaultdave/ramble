import Form from 'next/form';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { Photo } from '@/components/Photo';
import type { BrowseCard, BrowseView, FormTarget } from '@/lib/browse';
import { browsePath } from '@/lib/filters';
import styles from './BrowseResults.module.css';

type TargetButtonProps = {
  target: FormTarget;
  label: string;
  variant: 'primary' | 'secondary';
};

function TargetButton({ target, label, variant }: TargetButtonProps) {
  return (
    <Form action={target.action} className={styles.form}>
      {target.fields.map(([name, value]) => (
        <input
          key={`${name}=${value}`}
          type="hidden"
          name={name}
          value={value}
        />
      ))}
      <Button type="submit" variant={variant}>
        {label}
      </Button>
    </Form>
  );
}

export type BrowseResultsProps = BrowseView;

// A result card spans its grid column: at most 384px from the tablet width, the whole page on a phone.
const photoSizes = '(min-width: 768px) 384px, 100vw';

function ResultCard({ card }: { card: BrowseCard }) {
  const image = card.image ? (
    <Photo photo={card.image} sizes={photoSizes} />
  ) : null;
  return card.kind === 'guide-only' ? (
    <Card
      kind="guide-only"
      headingLevel={2}
      title={card.title}
      meta={card.meta}
      href={card.href}
      hostHref={card.hostHref}
      image={image}
    />
  ) : (
    <Card
      headingLevel={2}
      title={card.title}
      meta={card.meta}
      href={card.href}
      price={card.price}
      image={image}
    />
  );
}

export function BrowseResults(props: BrowseResultsProps) {
  switch (props.state) {
    case 'results':
      return (
        <div className={styles.results}>
          <p className={styles.summary}>{props.summary}</p>
          <ul className={styles.grid}>
            {props.cards.map((card) => (
              <li key={card.id} className={styles.item}>
                <ResultCard card={card} />
              </li>
            ))}
          </ul>
          <div className={styles.more}>
            {props.showMore ? (
              <TargetButton
                target={props.showMore}
                label="Show more"
                variant="secondary"
              />
            ) : null}
            {props.startHref ? (
              <ButtonLink href={props.startHref}>
                Back to the first results
              </ButtonLink>
            ) : null}
          </div>
        </div>
      );
    case 'empty':
      if (props.dated) {
        const { dateLabel, nextDay, anyDayHref, message } = props.dated;
        return (
          <div className={styles.notice}>
            <h2 className={styles.noticeTitle}>Nothing on {dateLabel}</h2>
            <p className={styles.noticeText}>{message}</p>
            <div className={styles.noticeActions}>
              {nextDay ? (
                <ButtonLink href={nextDay.href} variant="primary">
                  See {nextDay.label}
                </ButtonLink>
              ) : null}
              <ButtonLink href={anyDayHref} variant="secondary">
                Any day
              </ButtonLink>
            </div>
          </div>
        );
      }
      return (
        <div className={styles.notice}>
          <h2 className={styles.noticeTitle}>
            {props.filtered
              ? 'Nothing matches those filters'
              : 'Nothing to browse yet'}
          </h2>
          <p className={styles.noticeText}>
            {props.filtered
              ? 'Try another day, or take a filter off.'
              : 'New experiences are on their way.'}
          </p>
          {props.filtered ? (
            <ButtonLink href={browsePath}>Clear all filters</ButtonLink>
          ) : null}
        </div>
      );
    case 'error':
      return (
        <div className={styles.error}>
          <Alert
            tone="danger"
            title="We couldn't load experiences"
            body="Something went wrong on our side. Your filters are saved."
          />
          <TargetButton
            target={props.retry}
            label="Try again"
            variant="secondary"
          />
        </div>
      );
    case 'outdated':
      return (
        <div className={styles.notice}>
          <h2 className={styles.noticeTitle}>That page of results has moved</h2>
          <p className={styles.noticeText}>
            The list changed while you were reading it.
          </p>
          <ButtonLink href={props.startHref}>
            Back to the first results
          </ButtonLink>
        </div>
      );
  }
}
