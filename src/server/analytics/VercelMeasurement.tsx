import 'server-only';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { env } from '@/server/env';

// Outside Vercel the /_vercel/ script URLs return 404, which the e2e console check reports.
export function VercelMeasurement() {
  if (!env.VERCEL) return null;

  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
