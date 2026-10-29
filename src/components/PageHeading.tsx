import type { ReactNode } from 'react';
import styles from './PageHeading.module.css';

type PageHeadingProps = { title: string; children?: ReactNode };

export function PageHeading({ title, children }: PageHeadingProps) {
  return (
    <header className={styles.page}>
      <h1 className={styles.title}>{title}</h1>
      {children}
    </header>
  );
}
