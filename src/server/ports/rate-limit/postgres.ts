import 'server-only';
import { consumeRateLimitRow } from '@/server/db/rateLimits';
import type { RateLimiter } from './index';

export const postgresRateLimiter: RateLimiter = {
  consume: consumeRateLimitRow,
};
