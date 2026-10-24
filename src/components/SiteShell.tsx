import Link from 'next/link';
import type { ReactNode } from 'react';

type SiteShellProps = { areaName?: string; children: ReactNode };

export function SiteShell({ areaName, children }: SiteShellProps) {
  return (
    <>
      <a href="#main">Skip to main content</a>
      <header>
        <Link href="/">Ramble</Link>
        {areaName ? <span>{areaName}</span> : null}
      </header>
      <main id="main">{children}</main>
      <footer>
        <p>Ramble</p>
      </footer>
    </>
  );
}
