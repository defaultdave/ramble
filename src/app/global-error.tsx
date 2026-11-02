'use client';

import { ErrorNotice } from '@/components/ErrorNotice';
import '@/styles/base.css';
import '@/styles/tokens.css';

export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en">
      <head>
        <title>Something went wrong</title>
      </head>
      <body>
        <main>
          <ErrorNotice onRetry={retry} />
        </main>
      </body>
    </html>
  );
}
