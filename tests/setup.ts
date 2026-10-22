import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './msw/server';

// TEST-5: mock the network, and treat a request nobody handled as an error.
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
