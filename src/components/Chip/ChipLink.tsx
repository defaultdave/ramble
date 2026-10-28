import Link from 'next/link';
import styles from './Chip.module.css';

export type ChipLinkProps = {
  label: string;
  /** Where choosing the chip goes. The address is the state, so a chip is a link. */
  href: string;
  selected: boolean;
  /** A disabled chip names an address it cannot go to, so it renders without one. */
  disabled?: boolean;
};

export function ChipLink({
  label,
  href,
  selected,
  disabled = false,
}: ChipLinkProps) {
  if (disabled) {
    return (
      // A link without an href has no role, so the role is spelled out to keep it announced as unavailable.
      <a className={styles.chip} role="link" aria-disabled="true">
        {label}
      </a>
    );
  }
  return (
    <Link
      className={styles.chip}
      href={href}
      // Every chip is a different address; fetching them all ahead would load the whole filter grid.
      prefetch={false}
      aria-current={selected ? 'true' : undefined}
    >
      {label}
    </Link>
  );
}
