import type { ComponentPropsWithRef, MouseEvent, ReactNode } from 'react';
import styles from './Chip.module.css';

type ChipFaceProps = {
  label: string;
  count?: number | undefined;
  iconStart?: ReactNode;
};

function ChipFace({ label, count, iconStart }: ChipFaceProps) {
  return (
    <>
      {iconStart ? (
        <span className={styles.icon} aria-hidden="true">
          {iconStart}
        </span>
      ) : null}
      {label}
      {count === undefined ? null : (
        <span className={styles.count}>{count}</span>
      )}
    </>
  );
}

export type ChipProps = Omit<
  ComponentPropsWithRef<'button'>,
  'children' | 'onClick' | 'aria-pressed' | 'className' | 'style'
> & {
  selected: boolean;
  label: string;
  count?: number;
  iconStart?: ReactNode;
  onToggle: () => void;
};

export function Chip({
  selected,
  label,
  count,
  iconStart,
  onToggle,
  type = 'button',
  ...rest
}: ChipProps) {
  return (
    <button
      {...rest}
      type={type}
      className={styles.chip}
      aria-pressed={selected}
      onClick={onToggle}
    >
      <ChipFace label={label} count={count} iconStart={iconStart} />
    </button>
  );
}

export type DisclosureChipProps = Omit<
  ComponentPropsWithRef<'button'>,
  | 'children'
  | 'onClick'
  | 'aria-pressed'
  | 'aria-haspopup'
  | 'className'
  | 'style'
> & {
  label: string;
  count?: number;
  iconStart?: ReactNode;
  /** What the chip opens, for example the filter drawer. */
  popup: 'dialog';
  /** Gets the click, so the opener can be remembered and given focus back. */
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
};

/** A chip that opens something else. It looks like a chip and has no pressed state. */
export function DisclosureChip({
  label,
  count,
  iconStart,
  popup,
  onOpen,
  type = 'button',
  ...rest
}: DisclosureChipProps) {
  return (
    <button
      {...rest}
      type={type}
      className={styles.chip}
      aria-haspopup={popup}
      onClick={onOpen}
    >
      <ChipFace label={label} count={count} iconStart={iconStart} />
    </button>
  );
}
