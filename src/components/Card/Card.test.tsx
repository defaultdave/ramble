import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
import {
  Card,
  type BookableCardProps,
  type CardProps,
  type GuideOnlyCardProps,
} from './Card';

const photo = <div data-testid="photo" />;

const bookable = {
  title: 'Sunset kayak on the Hudson',
  meta: 'Pier 26 · 2 hr',
  href: '/experiences/sunset-kayak-12',
  image: photo,
  price: 'From $65',
};

describe('Card bookable', () => {
  it('links the title to the experience', () => {
    render(<Card {...bookable} />);
    expect(
      screen.getByRole('link', { name: 'Sunset kayak on the Hudson' }),
    ).toHaveAttribute('href', '/experiences/sunset-kayak-12');
  });

  it('shows the price per person', () => {
    render(<Card {...bookable} />);
    expect(screen.getByText('From $65').parentElement).toHaveTextContent(
      'From $65 per person',
    );
  });

  it('puts the title in a level 3 heading by default', () => {
    render(<Card {...bookable} />);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(
      'Sunset kayak on the Hudson',
    );
  });

  it.each([2, 4, 5] as const)(
    'puts the title in a level %i heading',
    (level) => {
      render(<Card {...bookable} headingLevel={level} />);
      expect(screen.getByRole('heading', { level })).toHaveTextContent(
        'Sunset kayak on the Hudson',
      );
    },
  );

  it.each([
    { count: 12, shown: true },
    { count: 5, shown: true },
    { count: 4, shown: false },
  ])('rating with $count reviews shown: $shown', ({ count, shown }) => {
    render(<Card {...bookable} rating={{ average: 4.9, count }} />);
    expect(screen.queryByText(`4.9 (${String(count)})`) !== null).toBe(shown);
    expect(
      screen.queryByText(`Rated 4.9 out of 5 from ${String(count)} reviews`) !==
        null,
    ).toBe(shown);
  });

  it('reads the rating in words and hides the compact form from screen readers', () => {
    render(<Card {...bookable} rating={{ average: 4.9, count: 12 }} />);
    expect(screen.getByText('4.9 (12)')).toHaveAttribute('aria-hidden', 'true');
    expect(
      screen.getByText('Rated 4.9 out of 5 from 12 reviews'),
    ).not.toHaveAttribute('aria-hidden');
  });

  it('shows no rating unless one is given', () => {
    render(<Card {...bookable} />);
    expect(screen.queryByText(/\(\d+\)/)).not.toBeInTheDocument();
  });
});

describe('Card layout', () => {
  const extras = {
    showPick: true,
    tag: { label: 'Outdoor', tone: 'green' as const },
  };

  it('vertical shows the pick label and the tag', () => {
    render(<Card {...bookable} {...extras} />);
    expect(screen.getByText('Ramble pick')).toBeVisible();
    expect(screen.getByText('Outdoor')).toBeVisible();
  });

  it('horizontal leaves out the pick label and the tag', () => {
    render(<Card {...bookable} {...extras} layout="horizontal" />);
    expect(screen.queryByText('Ramble pick')).not.toBeInTheDocument();
    expect(screen.queryByText('Outdoor')).not.toBeInTheDocument();
  });
});

describe('Card guide-only', () => {
  const guide = {
    title: 'Sunset kayak on the Hudson',
    meta: 'Pier 26 · 2 hr',
    href: '/guide/sunset-kayak-12',
    image: photo,
    kind: 'guide-only' as const,
    hostHref: 'https://host.example/kayak',
  };

  it('says it is not bookable and links out to the host in a new tab', () => {
    render(<Card {...guide} />);
    expect(screen.getByText('Not bookable on Ramble yet')).toBeVisible();
    const link = screen.getByRole('link', { name: /Visit host site/ });
    expect(link).toHaveAttribute('href', 'https://host.example/kayak');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAccessibleName('Visit host site (opens in a new tab)');
  });

  it('shows no price', () => {
    render(<Card {...guide} />);
    expect(screen.queryByText('per person')).not.toBeInTheDocument();
  });
});

describe('Card props', () => {
  it('rejects className, style, and a native title', () => {
    expectTypeOf<ComponentProps<typeof Card>>().not.toHaveProperty('className');
    expectTypeOf<ComponentProps<typeof Card>>().not.toHaveProperty('style');
  });

  it('requires a host link for guide-only and a price for bookable', () => {
    expectTypeOf<
      Omit<GuideOnlyCardProps, 'hostHref'>
    >().not.toExtend<CardProps>();
    expectTypeOf<Omit<BookableCardProps, 'price'>>().not.toExtend<CardProps>();
  });
});
