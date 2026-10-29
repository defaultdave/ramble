import { describe, expect, it, vi } from 'vitest';
import { pulseResponse } from '@/server/pulse';
import * as route from './route';

vi.mock('@/server/pulse', () => ({ pulseResponse: vi.fn() }));

// Behaviours under test:
// - every HTTP method the route exports goes to the one pulse handler, which refuses all but POST,
//   so a method Next would otherwise answer with 405 gets the same 401 as a wrong secret

describe('/api/pulse route', () => {
  it.each(['POST', 'GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const)(
    '%s is answered by the pulse handler',
    (method) => {
      expect(route[method]).toBe(pulseResponse);
    },
  );
});
