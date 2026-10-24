'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Dialog as AriaDialog,
  Heading,
  Modal,
  ModalOverlay,
} from 'react-aria-components';
import { classNames } from '@/lib/classNames';
import styles from './Dialog.module.css';

export type DialogVariant = 'sheet' | 'drawer';

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Sits above the title, for example a Badge. */
  eyebrow?: ReactNode;
  /** Pinned under the scrolling content. */
  footer?: ReactNode;
  /**
   * A sheet rises from the bottom at every width. A drawer does too on a
   * phone and becomes a side panel from 768px.
   */
  variant: DialogVariant;
  children: ReactNode;
};

const overlayClass = {
  sheet: classNames(styles.overlay),
  drawer: classNames(styles.overlay, styles.drawerOverlay),
} satisfies Record<DialogVariant, string | undefined>;

const modalClass = {
  sheet: classNames(styles.modal, styles.sheet),
  drawer: classNames(styles.modal, styles.drawer),
} satisfies Record<DialogVariant, string | undefined>;

export function Dialog({
  open,
  onClose,
  title,
  eyebrow,
  footer,
  variant,
  children,
}: DialogProps) {
  return (
    <ModalOverlay
      isOpen={open}
      isDismissable
      className={overlayClass[variant]}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Modal className={modalClass[variant]}>
        <AriaDialog className={classNames(styles.dialog)}>
          <div className={styles.handle} aria-hidden="true" />
          <div className={styles.header}>
            <div className={styles.heading}>
              {eyebrow}
              <Heading slot="title" className={classNames(styles.title)}>
                {title}
              </Heading>
            </div>
            <button
              type="button"
              className={styles.close}
              aria-label="Close"
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <div className={styles.body}>{children}</div>
          {footer ? <div className={styles.footer}>{footer}</div> : null}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
