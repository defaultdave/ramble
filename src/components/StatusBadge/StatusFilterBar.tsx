import { ChipLink } from '@/components/Chip';
import { statusFilterChips, type StatusFilterOption } from '@/lib/statusBadge';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './StatusFilterBar.module.css';

export type StatusFilterBarProps = {
  path: string;
  /** The address's params now. Choosing a status keeps the rest and starts from the first page. */
  query: TableQuery;
  options: readonly StatusFilterOption[];
  /** Names the group for a screen reader, for example "Filter orders by status". */
  label: string;
  allLabel?: string;
};

/** TODO(U-073): first caller. Links, not a script: the status is in the address, so a filtered table can be shared and reloaded. */
export function StatusFilterBar({
  path,
  query,
  options,
  label,
  allLabel,
}: StatusFilterBarProps) {
  const chips = statusFilterChips({ path, query, options, allLabel });
  return (
    <nav aria-label={label}>
      <ul className={styles.list}>
        {chips.map(({ id, label: chipLabel, href, selected }) => (
          <li key={id}>
            <ChipLink label={chipLabel} href={href} selected={selected} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
