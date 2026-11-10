import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ExperienceCard } from '@/lib/experienceCards';
import type { GuideEntryView } from '@/lib/pages/guide';
import { GuideEntry } from './GuideEntry';
import { GuideRelated } from './GuideRelated';

// Behaviours under test:
// - one h1 with the entry's name, its facts, and a notice that it is not bookable on Ramble
// - the link out goes to the host's site in a new tab, with no referrer, and says it opens in a new tab
// - an affiliate link carries rel=sponsored and a disclosure; a plain link out has neither
// - with no way out the page says so and shows no link
// - nothing on the page can be booked: no price, no booking control
// - the module lists bookable cards under "<Category> you can book" and renders nothing when there are none

const view: GuideEntryView = {
  title: 'Sourdough mornings at Rise Bakery',
  about: ['Knead and shape.', 'Take a loaf home.'],
  hostName: 'Rise Bakery',
  neighborhoodName: 'Park Slope',
  categoryName: 'Cooking',
  duration: '2.5 hr',
  outbound: { href: 'https://rise.example/classes', sponsored: false },
  cover: null,
};

const cards: ExperienceCard[] = [
  {
    id: '1',
    kind: 'bookable',
    title: 'Hand-rolled pasta',
    meta: 'Carroll Gardens · 2.5 hr',
    href: '/experiences/pasta-1',
    price: 'From $60',
    image: null,
  },
];

const link = () => screen.getByRole('link', { name: /Visit Rise Bakery/ });

describe('GuideEntry', () => {
  it('names the entry, where it is, and that it is not bookable', () => {
    render(<GuideEntry entry={view} related={null} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Sourdough mornings at Rise Bakery',
    );
    expect(screen.getByText('Park Slope')).toBeVisible();
    expect(screen.getByText('2.5 hr')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Not bookable on Ramble',
    );
    expect(screen.getByText('Take a loaf home.')).toBeVisible();
  });

  it('links out to the host in a new tab, with no referrer, and says so', () => {
    render(<GuideEntry entry={view} related={null} />);

    expect(link()).toHaveAttribute('href', 'https://rise.example/classes');
    expect(link()).toHaveAttribute('target', '_blank');
    expect(link()).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link()).toHaveTextContent('(opens in a new tab)');
    expect(screen.queryByText(/commission/)).not.toBeInTheDocument();
  });

  it('marks an affiliate link sponsored and discloses the commission', () => {
    render(
      <GuideEntry
        entry={{
          ...view,
          outbound: { href: 'https://aff.example/x', sponsored: true },
        }}
        related={null}
      />,
    );

    expect(link()).toHaveAttribute('href', 'https://aff.example/x');
    expect(link()).toHaveAttribute('rel', 'sponsored noopener noreferrer');
    expect(screen.getByText(/may earn a commission/)).toBeVisible();
  });

  it('says there is no booking link and shows none when there is no way out', () => {
    render(<GuideEntry entry={{ ...view, outbound: null }} related={null} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      "We don't have a booking link for Rise Bakery yet",
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('offers nothing to book: no price and no button', () => {
    render(<GuideEntry entry={view} related={null} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
  });

  it('leaves out the facts and text it has none of', () => {
    render(
      <GuideEntry
        entry={{ ...view, duration: null, about: [] }}
        related={null}
      />,
    );

    expect(screen.queryByText('2.5 hr')).not.toBeInTheDocument();
    expect(screen.queryByText('Knead and shape.')).not.toBeInTheDocument();
  });

  it('shows the module it is handed', () => {
    render(
      <GuideEntry
        entry={view}
        related={<GuideRelated categoryName="Cooking" cards={cards} />}
      />,
    );

    expect(
      screen.getByRole('region', { name: 'Cooking you can book' }),
    ).toBeVisible();
  });
});

describe('GuideRelated', () => {
  it('lists the bookable experiences under the category, each a link with its price', () => {
    render(<GuideRelated categoryName="Cooking" cards={cards} />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Cooking you can book' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Hand-rolled pasta' }),
    ).toHaveAttribute('href', '/experiences/pasta-1');
    expect(screen.getByText('From $60')).toBeVisible();
  });

  it('renders nothing when there are none', () => {
    const { container } = render(
      <GuideRelated categoryName="Cooking" cards={[]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
