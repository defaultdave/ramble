import { ButtonLink } from '@/components/Button';
import { RetryAlert } from '@/components/PageError';
import type { BrowseView } from '@/lib/pages/browse';
import { browsePath } from '@/lib/routes';
import styles from './BrowseResults.module.css';
import { BrowseResultsList } from './BrowseResultsList';
import { TargetButton } from './TargetButton';

export type BrowseResultsProps = BrowseView;

export function BrowseResults(props: BrowseResultsProps) {
  switch (props.state) {
    case 'results':
      return (
        <div className={styles.results}>
          <p className={styles.summary}>{props.summary}</p>
          <BrowseResultsList
            cards={props.cards}
            showMore={props.showMore}
            startHref={props.startHref}
          />
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
      if (props.wording === 'landing') {
        return (
          <div className={styles.notice}>
            <h2 className={styles.noticeTitle}>Nothing here yet</h2>
            <p className={styles.noticeText}>
              New experiences are on their way.
            </p>
            <ButtonLink href={browsePath}>Browse all experiences</ButtonLink>
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
        <RetryAlert
          alertTitle="We couldn't load experiences"
          alertBody={
            props.wording === 'landing'
              ? 'Something went wrong on our side. Try again in a moment.'
              : 'Something went wrong on our side. Your filters are saved.'
          }
        >
          <TargetButton
            target={props.retry}
            label="Try again"
            variant="secondary"
            fit
          />
        </RetryAlert>
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
