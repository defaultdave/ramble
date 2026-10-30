import 'server-only';

/** Time as the server code sees it. Jobs read it only from here, so a demo can run them at another date. */
export interface Clock {
  now(): Date;
}

export { systemClock } from './system';
export { fixedClock } from './fixed';
