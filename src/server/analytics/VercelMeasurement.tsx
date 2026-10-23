import 'server-only';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

export function VercelMeasurement() {
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
