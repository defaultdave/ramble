/** The one fixed instant the unit and database tests share, so "now" is the same everywhere. */
export const at = new Date('2026-11-01T12:00:00.000Z');

export const msFrom = (ms: number, from: Date = at) =>
  new Date(from.getTime() + ms);

export const minutesFrom = (count: number, from: Date = at) =>
  msFrom(count * 60_000, from);
