import type { ReactNode } from 'react';
import { Dialog } from '@/components/Dialog';

export type BookingSheetProps = {
  open: boolean;
  onClose: () => void;
  /** The experience name. */
  title: string;
  /** Sits above the title, for example a category Badge. */
  eyebrow?: ReactNode;
  /** The date, time, and party choices. */
  children: ReactNode;
  /** The total and the primary action. */
  footer?: ReactNode;
};

export function BookingSheet({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
}: BookingSheetProps) {
  return (
    <Dialog
      variant="sheet"
      open={open}
      onClose={onClose}
      title={title}
      eyebrow={eyebrow}
      footer={footer}
    >
      {children}
    </Dialog>
  );
}
