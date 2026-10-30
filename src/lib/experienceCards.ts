import { z } from 'zod';
import { EntityIdSchema, SlugSchema, guestVisibleStatuses } from './catalog';
import { durationLabel } from './duration';
import type { PhotoView } from './photoViews';
import { cardPriceLabel, type CardPriceOption } from './pricing';
import { experienceCardPath } from './routes';

/** The part of a price option a card reads: its amount, and whether a guest holding it takes a space. */
export const CardPriceOptionSchema = z.object({
  priceMinor: z.int().nonnegative(),
  usesSpace: z.boolean(),
}) satisfies z.ZodType<CardPriceOption>;

/** The photo a card draws, as `next/image` takes it. */
const CardImageSchema = z.object({
  src: z.string().min(1),
  width: z.int().positive(),
  height: z.int().positive(),
  alt: z.string(),
  blurDataUrl: z.string(),
}) satisfies z.ZodType<PhotoView>;

/** The part of an experience a card shows, with nothing a guest may not see. */
export const CardExperienceSchema = z.object({
  id: EntityIdSchema,
  slug: SlugSchema,
  name: z.string().min(1),
  status: z.enum(guestVisibleStatuses),
  neighborhoodName: z.string().min(1),
  durationMinutes: z.int().positive().nullable(),
  linkOutUrl: z.string().nullable(),
  priceOptions: z.array(CardPriceOptionSchema),
  /** The cover, for a read that joins it in; a read that does not leaves it out and the page sets it. */
  image: CardImageSchema.nullish(),
});
export type CardExperience = z.infer<typeof CardExperienceSchema>;

export type PriceRow = z.infer<typeof CardPriceOptionSchema> & {
  experienceId: string;
};

/** Each experience with the prices that belong to it, lowest first. A price for an experience that is not listed is ignored. */
export function withPriceOptions<T extends { id: string }>(
  rows: readonly T[],
  prices: readonly PriceRow[],
): (T & { priceOptions: CardPriceOption[] })[] {
  return rows.map((row) => ({
    ...row,
    priceOptions: prices
      .filter((price) => price.experienceId === row.id)
      .map(({ priceMinor, usesSpace }) => ({ priceMinor, usesSpace }))
      .sort((a, b) => a.priceMinor - b.priceMinor),
  }));
}

export type ExperienceCard = {
  id: string;
  title: string;
  meta: string;
  href: string;
  /** The experience's cover photo; null shows the card's missing-image state. */
  image: PhotoView | null;
} & (
  { kind: 'bookable'; price: string } | { kind: 'guide-only'; hostHref: string }
);

/**
 * What a card says about an experience, or null when it cannot be shown as one: a bookable
 * experience with no price option that takes a space, or a guide entry with no link out. A card is
 * left out, never repaired. The reads keep both out already, but prices can be read after the
 * experiences, so a host who removes the last price between the two reads would otherwise take the
 * whole page down.
 */
export function toExperienceCard(
  experience: CardExperience,
): ExperienceCard | null {
  const meta = [
    experience.neighborhoodName,
    experience.durationMinutes === null
      ? null
      : durationLabel(experience.durationMinutes),
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const base = {
    id: experience.id,
    title: experience.name,
    meta,
    href: experienceCardPath(experience),
    image: experience.image ?? null,
  };
  if (experience.status === 'guide_only') {
    return experience.linkOutUrl === null
      ? null
      : { ...base, kind: 'guide-only', hostHref: experience.linkOutUrl };
  }
  const price = cardPriceLabel(experience.priceOptions);
  return price === null ? null : { ...base, kind: 'bookable', price };
}

/** The cards for `ids`, in that order. An ID with no experience, or one that cannot be a card, is skipped. */
export function cardsInOrder(
  ids: readonly string[],
  experiences: readonly CardExperience[],
  limit: number,
): ExperienceCard[] {
  const byId = new Map(
    experiences.map((experience) => [experience.id, experience]),
  );
  const cards: ExperienceCard[] = [];
  for (const id of ids) {
    if (cards.length >= limit) break;
    const experience = byId.get(id);
    const card = experience ? toExperienceCard(experience) : null;
    if (card) cards.push(card);
  }
  return cards;
}
