import type { ReactNode, Ref } from 'react';
import styles from './PageHeading.module.css';

type PageHeadingProps = {
  title: string;
  /** Lets a caller move focus to the heading, which is focusable by script but not by Tab. */
  headingRef?: Ref<HTMLHeadingElement>;
  children?: ReactNode;
};

export function PageHeading({ title, headingRef, children }: PageHeadingProps) {
  return (
    <header className={styles.page}>
      <h1
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className={styles.title}
      >
        {title}
      </h1>
      {children}
    </header>
  );
}
