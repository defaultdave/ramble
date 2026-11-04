import { ChipLink } from '@/components/Chip';
import type { ChipView } from '@/lib/filters';
import styles from './FilterBar.module.css';

export type ChipGroupProps = {
  legend: string;
  chips: readonly ChipView[];
};

export function ChipGroup({ legend, chips }: ChipGroupProps) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.chips}>
        {chips.map(({ key, label, selected, disabled, href }) => (
          <ChipLink
            key={key}
            label={label}
            selected={selected}
            disabled={disabled}
            href={href}
          />
        ))}
      </div>
    </fieldset>
  );
}
