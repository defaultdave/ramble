import Link from 'next/link';
import styles from './BookingListRow.module.css';

/**
 * One booking in a list: a title, supporting lines, and one link. `linkHint` is read aloud after
 * the link's label and not shown, so links that share a label can be told apart.
 */
export function BookingListRow({
  title,
  details,
  href,
  linkLabel,
  linkHint,
}: {
  title: string;
  details: readonly string[];
  href: string;
  linkLabel: string;
  linkHint?: string;
}) {
  return (
    <li className={styles.row}>
      <p className={styles.primary}>{title}</p>
      {details.map((line) => (
        <p key={line} className={styles.secondary}>
          {line}
        </p>
      ))}
      <Link href={href} className={styles.link}>
        {linkLabel}
        {linkHint === undefined ? null : (
          <>
            {' '}
            <span className={styles.visuallyHidden}>{linkHint}</span>
          </>
        )}
      </Link>
    </li>
  );
}
