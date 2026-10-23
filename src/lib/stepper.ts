export type StepperLimits = { atMin: boolean; atMax: boolean };

export function stepperLimits(
  value: number,
  min: number,
  max: number,
): StepperLimits {
  return { atMin: value <= min, atMax: value >= max };
}

export function steppedValue(
  value: number,
  delta: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, value + delta));
}
