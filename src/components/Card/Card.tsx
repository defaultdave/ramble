import { ExternalLink, Star } from 'lucide-react';
import Link from 'next/link';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Badge, type BadgeProps } from '@/components/Badge';
import { classNames } from '@/lib/classNames';
import { ratingDescription, ratingLabel, type Rating } from '@/lib/rating';
import styles from './Card.module.css';

export type CardLayout = 'vertical' | 'horizontal';

// The width a card's photo takes, for Photo's `sizes`: the card's column on a vertical card (at most
// 384px from the tablet width, the whole page on a phone), a fixed square beside the text on a horizontal one.
export const cardPhotoSizes = {
  vertical: '(min-width: 768px) 384px, 100vw',
  horizontal: '168px',
} as const satisfies Record<CardLayout, string>;
export type CardHeadingLevel = 2 | 3 | 4 | 5;
export type CardTag = {
  label: string;
  tone?: NonNullable<BadgeProps['tone']>;
  icon?: ReactNode;
};

type CardBaseProps = Omit<
  ComponentPropsWithoutRef<'article'>,
  'title' | 'children' | 'className' | 'style'
> & {
  layout?: CardLayout;
  title: string;
  meta: string;
  href: string;
  image: ReactNode;
  headingLevel?: CardHeadingLevel;
  showPick?: boolean;
  tag?: CardTag;
};

export type BookableCardProps = CardBaseProps & {
  kind?: 'bookable';
  price: string;
  rating?: Rating;
  hostHref?: never;
};

export type GuideOnlyCardProps = CardBaseProps & {
  kind: 'guide-only';
  hostHref: string;
  price?: never;
  rating?: never;
};

export type CardProps = BookableCardProps | GuideOnlyCardProps;

const headingTag = {
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
} satisfies Record<CardHeadingLevel, 'h2' | 'h3' | 'h4' | 'h5'>;

export function Card({
  layout = 'vertical',
  title,
  meta,
  href,
  image,
  headingLevel = 3,
  showPick = false,
  tag,
  kind,
  price,
  rating,
  hostHref,
  ...rest
}: CardProps) {
  const Heading = headingTag[headingLevel];
  const vertical = layout === 'vertical';
  const ratingText = rating ? ratingLabel(rating) : null;
  const ratingSpoken = rating ? ratingDescription(rating) : null;

  return (
    <article
      {...rest}
      className={classNames(
        styles.card,
        vertical ? styles.vertical : styles.horizontal,
      )}
    >
      <div className={styles.image}>
        {image}
        {vertical && showPick ? (
          <span className={styles.pick}>
            <Star className={styles.pickIcon} aria-hidden="true" />
            Ramble pick
          </span>
        ) : null}
      </div>
      <div className={styles.content}>
        {vertical && tag ? <Badge {...tag} /> : null}
        <Heading className={styles.title}>
          <Link href={href} className={styles.titleLink}>
            {title}
          </Link>
        </Heading>
        <p className={styles.meta}>{meta}</p>
        <div className={styles.footer}>
          {kind === 'guide-only' ? (
            <div className={styles.guide}>
              <p className={styles.guideNote}>Not bookable on Ramble yet</p>
              <a
                className={styles.hostLink}
                href={hostHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className={styles.hostIcon} aria-hidden="true" />
                Visit host site{' '}
                <span className={styles.visuallyHidden}>
                  (opens in a new tab)
                </span>
              </a>
            </div>
          ) : (
            <>
              <p className={styles.price}>
                <span className={styles.priceAmount}>{price}</span>{' '}
                <span className={styles.priceUnit}>per person</span>
              </p>
              {ratingText ? (
                <p className={styles.rating}>
                  <Star className={styles.ratingIcon} aria-hidden="true" />
                  <span aria-hidden="true">{ratingText}</span>
                  <span className={styles.visuallyHidden}>{ratingSpoken}</span>
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </article>
  );
}
