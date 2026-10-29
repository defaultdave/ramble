'use client';

import { ErrorNotice } from '@/components/ErrorNotice';
import '@/styles/base.css';
import '@/styles/tokens.css';

export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <main>
          <ErrorNotice onRetry={retry} />
        </main>
      </body>
    </html>
  );
}
