import { expect, it, vi } from 'vitest';

// Behaviours under test:
// - GET (the verify address) and POST (the sign-in link request) both go through the auth handler, so the rate limit sits in front of every sign-in request

vi.mock('@/server/auth/handler', () => ({ handleAuthRequest: vi.fn() }));

it('hands GET and POST to the auth handler', async () => {
  const { handleAuthRequest } = await import('@/server/auth/handler');
  const route = await import('./route');

  expect(route.GET).toBe(handleAuthRequest);
  expect(route.POST).toBe(handleAuthRequest);
});
