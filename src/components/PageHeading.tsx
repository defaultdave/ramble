import type { ReactNode } from 'react';

type PageHeadingProps = { title: string; children?: ReactNode };

export function PageHeading({ title, children }: PageHeadingProps) {
  return (
    <header>
      <h1>{title}</h1>
      {children}
    </header>
  );
}
