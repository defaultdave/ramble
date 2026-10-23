const BADGE_TONES = ['green', 'yellow', 'blue', 'pink', 'neutral'] as const;

export type BadgeTone = (typeof BADGE_TONES)[number];

const FALLBACK_TONE: BadgeTone = 'neutral';

// Tags can arrive from content data, so an unknown tone must not break the card.
export function resolveBadgeTone(tone: string | null | undefined): BadgeTone {
  return BADGE_TONES.find((known) => known === tone) ?? FALLBACK_TONE;
}
