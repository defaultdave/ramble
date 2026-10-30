import type { ReactNode } from 'react';
import { PageHeading } from '@/components/PageHeading';
import styles from './DemoPage.module.css';

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
