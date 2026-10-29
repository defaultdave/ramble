import type { ReactNode } from 'react';
import { PageHeading } from '@/components/PageHeading';
import styles from './DemoPage.module.css';

// TODO(U-047b): replaced by the checkout page's own layout.
export function DemoPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <PageHeading title={title}>{children}</PageHeading>
    </div>
  );
}
