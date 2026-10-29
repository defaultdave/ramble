import 'server-only';
import type { Clock } from './index';

export const systemClock: Clock = {
  now: () => new Date(),
};
