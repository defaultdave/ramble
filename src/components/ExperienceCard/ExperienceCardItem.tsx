import {
  Card,
  cardPhotoSizes,
  type CardHeadingLevel,
  type CardLayout,
} from '@/components/Card';
import { Photo } from '@/components/Photo';
import type { ExperienceCard } from '@/lib/experienceCards';

export type ExperienceCardItemProps = {
  card: ExperienceCard;
  layout: CardLayout;
  /** The surface decides the level: its own heading sits one level above. */
  headingLevel: CardHeadingLevel;
};

export function ExperienceCardItem({
  card,
  layout,
  headingLevel,
}: ExperienceCardItemProps) {
  const image = card.image ? (
    <Photo photo={card.image} sizes={cardPhotoSizes[layout]} />
  ) : null;
  return card.kind === 'guide-only' ? (
    <Card
      kind="guide-only"
      layout={layout}
      headingLevel={headingLevel}
      title={card.title}
      meta={card.meta}
      href={card.href}
      hostHref={card.hostHref}
      image={image}
    />
  ) : (
    <Card
      layout={layout}
      headingLevel={headingLevel}
      title={card.title}
      meta={card.meta}
      href={card.href}
      price={card.price}
      image={image}
    />
  );
}
