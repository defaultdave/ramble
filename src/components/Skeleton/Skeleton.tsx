import type { ComponentPropsWithoutRef } from 'react';
import { classNames } from '@/lib/classNames';
import styles from './Skeleton.module.css';

export type SkeletonKind = 'card' | 'horizontal-card' | 'text';

export type SkeletonProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'aria-hidden'
> & {
  kind: SkeletonKind;
};

const kindClass = {
  card: styles.card,
  'horizontal-card': styles.horizontalCard,
  text: styles.text,
} satisfies Record<SkeletonKind, string | undefined>;

export function Skeleton({ kind, ...rest }: SkeletonProps) {
  return (
    <div
      {...rest}
      aria-hidden="true"
      className={classNames(styles.skeleton, kindClass[kind])}
    >
      {kind === 'text' ? (
        <>
          <span className={styles.line} />
          <span className={styles.line} />
          <span className={styles.line} />
        </>
      ) : (
        <>
          <div className={styles.image} />
          <div className={styles.content}>
            {kind === 'card' ? <span className={styles.tag} /> : null}
            <span className={styles.title} />
            <span className={styles.meta} />
            <span className={styles.price} />
          </div>
        </>
      )}
    </div>
  );
}
