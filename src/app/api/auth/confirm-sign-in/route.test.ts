import { expect, it, vi } from 'vitest';

// Behaviours under test:
// - only POST is exported, so a GET, which is what a mail scanner or a prefetch sends, is answered 405 by Next and uses nothing

vi.mock('@/server/auth/forms', () => ({
  handleConfirmSignIn: vi.fn(),
  handleEndSession: vi.fn(),
}));

it('exports the confirm handler for POST and nothing for GET', async () => {
  const { handleConfirmSignIn } = await import('@/server/auth/forms');
  const route = await import('./route');

  expect(route.POST).toBe(handleConfirmSignIn);
  expect(Object.keys(route)).toEqual(['POST']);
});
