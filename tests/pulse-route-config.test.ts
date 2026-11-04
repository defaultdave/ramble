import { expect, it, vi } from 'vitest';
import { jobLimits } from '@/lib/jobs';

// Behaviours under test:
// - the pulse route may run as long as a job lock lasts, so a run never outlives the claim it holds

vi.mock('@/server/pulse', () => ({ pulseResponse: vi.fn() }));

it('lets the pulse route run as long as a job lock lasts', async () => {
  const route = await import('@/app/api/pulse/route');

  expect(route.maxDuration).toBe(jobLimits.lockSeconds);
});
