import type { RequestHandler } from 'msw';

/** Default handlers shared by every test. Add per-test overrides with `server.use(...)`. */
export const handlers: RequestHandler[] = [];
