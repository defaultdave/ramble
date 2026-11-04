/** Whether `value` is a safe integer from `min` up to `max` (no upper bound when `max` is left out). */
export function isSafeIntegerInRange(
  value: number,
  min: number,
  max: number = Number.MAX_SAFE_INTEGER,
): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

/** Throws a RangeError naming `what` unless `value` is a safe integer from `min` to `max`. */
export function requireIntegerInRange(
  value: number,
  min: number,
  max: number,
  what: string,
): void {
  if (!isSafeIntegerInRange(value, min, max)) {
    throw new RangeError(
      `${what} must be an integer from ${String(min)} to ${String(max)}, got ${String(value)}`,
    );
  }
}
