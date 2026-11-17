import { Star } from 'lucide-react';
import { classNames } from '@/lib/classNames';
import type { ReviewsView } from '@/lib/reviewList';
import { reviewLimits } from '@/lib/reviews';
import styles from './ReviewsBlock.module.css';

export type ReviewsBlockProps = { view: ReviewsView };

function Stars({ filled }: { filled: number }) {
  return (
    <span className={styles.stars} aria-hidden="true">
      {Array.from({ length: reviewLimits.maxRating }, (_, index) => (
        <Star
          key={index}
          className={classNames(
            styles.star,
            index < filled ? styles.filled : styles.empty,
          )}
        />
      ))}
    </span>
  );
}

/**
 * What guests wrote about the experience: the mean and the count, then the newest reviews. The page
 * draws it only for an experience with the threshold of reviews (`reviewsView` is null below it),
 * so it never has to say "no reviews yet".
 */
export function ReviewsBlock({ view }: ReviewsBlockProps) {
  return (
    <div className={styles.block}>
      <p className={styles.summary}>
        <Stars filled={view.stars} />
        <span aria-hidden="true">
          <span className={styles.average}>{view.average}</span> ·{' '}
          {view.countLabel}
        </span>
        <span className={styles.visuallyHidden}>{view.spoken}</span>
      </p>
      <ul className={styles.list} role="list">
        {view.items.map((item) => (
          <li key={item.id} className={styles.review}>
            <p className={styles.byline}>
              <Stars filled={item.rating} />
              <span className={styles.visuallyHidden}>{item.ratingText}</span>
              <span className={styles.author}>{item.author}</span>
              <span className={styles.date}>{item.dateLabel}</span>
            </p>
            {item.paragraphs.map((paragraph, index) => (
              <p key={index} className={styles.body}>
                {paragraph}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
