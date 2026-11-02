import type { ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import styles from './FilterDrawer.module.css';

export type FilterDrawerProps = {
  open: boolean;
  onClose: () => void;
  onClear: () => void;
  onApply: () => void;
  /** The primary action, for example "Show 24 results". */
  applyLabel: string;
  /** The filter groups. */
  children: ReactNode;
};

export function FilterDrawer({
  open,
  onClose,
  onClear,
  onApply,
  applyLabel,
  children,
}: FilterDrawerProps) {
  return (
    <Dialog
      variant="drawer"
      open={open}
      onClose={onClose}
      title="Filters"
      footer={
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClear}>
            Clear all
          </Button>
          <div className={styles.apply}>
            <Button onClick={onApply}>{applyLabel}</Button>
          </div>
        </div>
      }
    >
      {children}
    </Dialog>
  );
}
