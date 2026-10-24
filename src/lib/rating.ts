export type Rating = { average: number; count: number };

// Reviews show once an experience has at least this many.
const MIN_REVIEWS_TO_SHOW = 5;

export function ratingLabel({ average, count }: Rating): string | null {
  if (count < MIN_REVIEWS_TO_SHOW) return null;
  return `${average.toFixed(1)} (${String(count)})`;
}
