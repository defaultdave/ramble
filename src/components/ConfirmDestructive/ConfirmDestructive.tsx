'use client';

import { useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import styles from './ConfirmDestructive.module.css';

export type ConfirmDestructiveProps = {
  /** The button that opens the dialog, named for the thing it removes: "Delete note", not "Delete". */
  triggerLabel: string;
  title: string;
  /** What will be lost, and whether it can be undone. */
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** A Server Action. It runs only when the user confirms, and gets the form's fields. */
  action: (formData: FormData) => void | Promise<void>;
  /** Hidden inputs that say which record, so the action never trusts the page to remember it. */
  children?: ReactNode;
};

function ConfirmButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" loading={pending}>
      {label}
    </Button>
  );
}

/** TODO(U-073): first caller. Opens a dialog that must be answered before the action runs. Cancel has focus first, so Enter alone never destroys anything. */
export function ConfirmDestructive({
  triggerLabel,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  action,
  children,
}: ConfirmDestructiveProps) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };

  const run = async (formData: FormData) => {
    try {
      await action(formData);
    } finally {
      close();
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        {triggerLabel}
      </Button>
      <Dialog
        variant="sheet"
        open={open}
        onClose={close}
        title={title}
        footer={
          <form action={run} className={styles.form}>
            {children}
            <Button variant="secondary" size="lg" autoFocus onClick={close}>
              {cancelLabel}
            </Button>
            <div className={styles.confirm}>
              <ConfirmButton label={confirmLabel} />
            </div>
          </form>
        }
      >
        <div className={styles.description}>{description}</div>
      </Dialog>
    </>
  );
}
