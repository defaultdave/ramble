import { expect, it, vi } from 'vitest';

// Behaviours under test:
// - only POST is exported, so a link or a prefetch cannot sign anyone out

vi.mock('@/server/auth/forms', () => ({
  handleConfirmSignIn: vi.fn(),
  handleEndSession: vi.fn(),
}));

it('exports the sign-out handler for POST and nothing for GET', async () => {
  const { handleEndSession } = await import('@/server/auth/forms');
  const route = await import('./route');

  expect(route.POST).toBe(handleEndSession);
  expect(Object.keys(route)).toEqual(['POST']);
});
