export const at = new Date('2026-11-01T12:00:00.000Z');

export const msFrom = (ms: number, from: Date = at) =>
  new Date(from.getTime() + ms);

export const minutesFrom = (minutes: number, from: Date = at) =>
  msFrom(minutes * 60_000, from);
