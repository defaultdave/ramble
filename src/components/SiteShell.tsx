import Link from 'next/link';
import type { ReactNode } from 'react';
import { brandName } from '@/lib/pages/brand';

type SiteShellProps = { areaName?: string; children: ReactNode };

export function SiteShell({ areaName, children }: SiteShellProps) {
  return (
    <>
      <a href="#main">Skip to main content</a>
      <header>
        <Link href="/">{brandName}</Link>
        {areaName ? <span>{areaName}</span> : null}
      </header>
      <main id="main">{children}</main>
      <footer>
        <p>{brandName}</p>
      </footer>
    </>
  );
}
