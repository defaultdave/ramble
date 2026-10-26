import Link from 'next/link';
import { classNames } from '@/lib/classNames';
import styles from './SimilarLink.module.css';

export type SimilarLinkSize = 'md' | 'lg';

// A link, not a Button: it goes to other experiences, and Button renders only a <button>.
export function SimilarLink({
  href,
  size,
  label,
}: {
  href: string;
  size: SimilarLinkSize;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={classNames(styles.link, size === 'lg' && styles.lg)}
    >
      {label}
    </Link>
  );
}
