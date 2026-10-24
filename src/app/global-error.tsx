'use client';

import { ErrorNotice } from '@/components/ErrorNotice';

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
