import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { samplePhoto } from '@/components/Photo/Photo.fixtures';
import type { ExperienceCard } from '@/lib/experienceCards';
import { ExperienceCardItem } from './ExperienceCardItem';

// Behaviours under test:
// - a bookable card links its title and shows its price per person
// - a free card shows "Free per person", never "$0"
// - a guide entry links out to the host and shows no price
// - the heading level is the one the surface asks for
// - a cover photo is drawn with its alt text, and a card with none draws no image

const bookable = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Sunset kayak on the Hudson',
  meta: 'Pier 26 · 2 hr',
  href: '/experiences/sunset-kayak-1',
  image: null,
  kind: 'bookable',
  price: 'From $65',
} satisfies ExperienceCard;

const guideOnly = {
  id: '00000000-0000-4000-8000-000000000002',
  title: 'A harbor walk with a historian',
  meta: 'Red Hook · 2 hr',
  href: '/guide/a-harbor-walk-2',
  image: null,
  kind: 'guide-only',
  hostHref: 'https://host.example/walk',
} satisfies ExperienceCard;

describe('ExperienceCardItem', () => {
  it('links the title and shows the price per person', () => {
    render(
      <ExperienceCardItem card={bookable} layout="vertical" headingLevel={3} />,
    );
    expect(
      screen.getByRole('link', { name: 'Sunset kayak on the Hudson' }),
    ).toHaveAttribute('href', '/experiences/sunset-kayak-1');
    expect(screen.getByText('From $65').parentElement).toHaveTextContent(
      'From $65 per person',
    );
  });

  it('reads a free card as Free per person', () => {
    render(
      <ExperienceCardItem
        card={{ ...bookable, price: 'Free' }}
        layout="horizontal"
        headingLevel={3}
      />,
    );
    expect(screen.getByText('Free').parentElement).toHaveTextContent(
      'Free per person',
    );
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
  });

  it('links a guide entry out to the host and shows no price', () => {
    render(
      <ExperienceCardItem
        card={guideOnly}
        layout="vertical"
        headingLevel={3}
      />,
    );
    expect(
      screen.getByRole('link', { name: /Visit host site/ }),
    ).toHaveAttribute('href', 'https://host.example/walk');
    expect(screen.queryByText(/per person/)).not.toBeInTheDocument();
  });

  it.each([2, 3] as const)('puts the title in a level %i heading', (level) => {
    render(
      <ExperienceCardItem
        card={bookable}
        layout="vertical"
        headingLevel={level}
      />,
    );
    expect(screen.getByRole('heading', { level })).toHaveTextContent(
      'Sunset kayak on the Hudson',
    );
  });

  it('draws the cover photo, and no image without one', () => {
    const { rerender } = render(
      <ExperienceCardItem
        card={{ ...bookable, image: samplePhoto(0) }}
        layout="vertical"
        headingLevel={3}
      />,
    );
    expect(screen.getByRole('img', { name: 'Photo 1' })).toBeInTheDocument();
    rerender(
      <ExperienceCardItem card={bookable} layout="vertical" headingLevel={3} />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
