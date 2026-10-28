import { Card, type CardLayout } from '@/components/Card';
import type { HomeCard } from '@/lib/home';

type HomeCardItemProps = { card: HomeCard; layout: CardLayout };

export function HomeCardItem({ card, layout }: HomeCardItemProps) {
  // TODO(U-010): the experience photo, once the photos table exists.
  const image = null;
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
