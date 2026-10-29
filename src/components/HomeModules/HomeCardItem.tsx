import { Card, type CardLayout } from '@/components/Card';
import { Photo } from '@/components/Photo';
import type { HomeCard } from '@/lib/home';

type HomeCardItemProps = { card: HomeCard; layout: CardLayout };

// The width the photo takes: a fixed square beside the text, or the card's own width.
const photoSizes = {
  vertical: '(min-width: 768px) 384px, 100vw',
  horizontal: '168px',
} as const satisfies Record<CardLayout, string>;

export function HomeCardItem({ card, layout }: HomeCardItemProps) {
  const image = card.image ? (
    <Photo photo={card.image} sizes={photoSizes[layout]} />
  ) : null;
  return card.kind === 'guide-only' ? (
    <Card
      kind="guide-only"
      layout={layout}
      headingLevel={3}
      title={card.title}
      meta={card.meta}
      href={card.href}
      hostHref={card.hostHref}
      image={image}
    />
  ) : (
    <Card
      layout={layout}
      headingLevel={3}
      title={card.title}
      meta={card.meta}
      href={card.href}
      price={card.price}
      image={image}
    />
  );
}
