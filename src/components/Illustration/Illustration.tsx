import type { ComponentPropsWithoutRef } from 'react';
import { useId } from 'react';
import styles from './Illustration.module.css';

export type IllustrationProps = Omit<
  ComponentPropsWithoutRef<'svg'>,
  'children' | 'aria-hidden' | 'className' | 'style'
>;

const FRAME =
  'M0 20C0 8.95431 8.95431 0 20 0H140C151.046 0 160 8.95431 160 20V100C160 111.046 151.046 120 140 120H20C8.95431 120 0 111.046 0 100V20Z';

export function Illustration(props: IllustrationProps) {
  const clipId = useId();

  return (
    <svg
      width="160"
      height="120"
      viewBox="0 0 160 120"
      {...props}
      aria-hidden="true"
      className={styles.illustration}
    >
      <clipPath id={clipId}>
        <path d={FRAME} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <path className={styles.sky} d={FRAME} />
        <circle className={styles.sun} cx="48" cy="46" r="28" />
        <ellipse className={styles.hill} cx="90" cy="123" rx="100" ry="45" />
      </g>
    </svg>
  );
}
