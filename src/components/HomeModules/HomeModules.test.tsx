import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { homeCopy } from '@/lib/home';
import { HomeModules } from './HomeModules';
import {
  categoryRail,
  fullPage,
  giftGuide,
  hero,
  picks,
  reassurance,
  renderCopy,
  thisWeek,
} from './HomeModules.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - the hero is the page's one h1, with its copy, and its search is a GET form to the browse page
// - the search offers every neighborhood after "Anywhere", a date no earlier than today that starts on today, and a submit
// - each category links to the browse page filtered by it
// - Ramble Picks shows its cards under an h2 with an h3 each, links to the whole Pick, and carries the anchor
// - a guide-only card links out and says it is not bookable
// - the gift guide links to /gifts and carries the sponsor line; without copy it shows none
// - "On this week" lists its cards; the reassurance rows list their facts, each with the icon it carries
// - every module is a labelled region, and the modules appear in the order they are given
// - no module renders nothing

function render_(modules = fullPage) {
  return render(
    <HomeModules
      modules={modules}
      minDate="2026-11-02"
      renderCopy={renderCopy}
    />,
  );
}

describe('hero', () => {
  it('is the only h1, with the staff copy beneath it', () => {
    render_([hero]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Something good to do this weekend',
    );
    expect(
      screen.getByText(/Classes, walks, tastings, and trips/),
    ).toBeInTheDocument();
  });
});

describe('hero search', () => {
  it('submits the neighborhood and the day to the browse page', () => {
    render_([hero]);
    const form = screen.getByRole('form', { name: 'Find something to do' });
    expect(form).toHaveAttribute('action', '/new-york/browse');
    expect(form).toHaveAttribute('method', 'get');
    expect(screen.getByLabelText('Neighborhood')).toHaveAttribute(
      'name',
      'neighborhood',
    );
    expect(screen.getByLabelText('When')).toHaveAttribute('name', 'date');
    expect(
      within(form).getByRole('button', { name: 'Find something to do' }),
    ).toHaveAttribute('type', 'submit');
  });

  it('offers anywhere first, then each neighborhood by its slug', () => {
    render_([hero]);
    const options = within(screen.getByLabelText('Neighborhood')).getAllByRole(
      'option',
    );
    expect(
      options.map((o) => [o.textContent, o.getAttribute('value')]),
    ).toEqual([
      ['Anywhere in New York', ''],
      ['Carroll Gardens', 'carroll-gardens'],
      ['DUMBO', 'dumbo'],
      ['Greenpoint', 'greenpoint'],
    ]);
  });

  it('offers no day before the one it was given', () => {
    render_([hero]);
    expect(screen.getByLabelText('When')).toHaveAttribute('min', '2026-11-02');
    expect(screen.getByLabelText('When')).toHaveAttribute('type', 'date');
  });
});

describe('hero search date', () => {
  it('starts on the day it was given, which is the earliest it offers', () => {
    render_([hero]);
    expect(screen.getByLabelText('When')).toHaveValue('2026-11-02');
  });
});

describe('category rail', () => {
  it('links each category to browse filtered by it', () => {
    render_([categoryRail]);
    const region = screen.getByRole('region', { name: 'Browse by category' });
    const links = within(region).getAllByRole('link');
    expect(links).toHaveLength(8);
    expect(
      within(region).getByRole('link', { name: 'Cooking' }),
    ).toHaveAttribute('href', '/new-york/browse?category=cooking');
  });
});

describe('ramble picks', () => {
  it('shows its cards, one h3 each, under its h2', () => {
    render_([picks]);
    const region = screen.getByRole('region', { name: 'Rainy day, sorted' });
    expect(within(region).getAllByRole('heading', { level: 3 })).toHaveLength(
      3,
    );
    expect(
      within(region).getByRole('link', {
        name: 'Hand-rolled pasta in a Carroll Gardens kitchen',
      }),
    ).toHaveAttribute(
      'href',
      '/experiences/thing-1-00000000-0000-4000-8000-000000000001',
    );
  });

  it('links to the whole Pick and carries the anchor the header links to', () => {
    render_([picks]);
    expect(
      screen.getByRole('link', { name: 'See all 12 picks' }),
    ).toHaveAttribute('href', '/picks/rainy-day');
    expect(
      screen.getByRole('region', { name: 'Rainy day, sorted' }),
    ).toHaveAttribute('id', 'picks');
  });

  it('sends a guide-only card out to the host and says it is not bookable', () => {
    render_([picks]);
    const link = screen.getByRole('link', { name: /Visit host site/ });
    expect(link).toHaveAttribute('href', 'https://host.example/walk');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Not bookable on Ramble yet')).toBeInTheDocument();
  });

  it('leaves out the summary when there is none', () => {
    render_([{ ...picks, summary: null } as typeof picks]);
    expect(screen.queryByText(/Twelve indoor plans/)).not.toBeInTheDocument();
  });
});

describe('gift guide', () => {
  it('links to the gift guide and names the sponsor', () => {
    render_([giftGuide]);
    const region = screen.getByRole('region', {
      name: 'Give a Saturday, not a sweater',
    });
    expect(
      within(region).getByRole('link', { name: 'Shop the gift guide' }),
    ).toHaveAttribute('href', '/gifts');
    expect(
      within(region).getByText('Presented by our holiday partner'),
    ).toBeInTheDocument();
    expect(within(region).getByText(/They pick the date/)).toBeInTheDocument();
  });

  it('shows no copy block when staff wrote none', () => {
    render_([{ ...giftGuide, body: null } as typeof giftGuide]);
    expect(screen.queryByText(/They pick the date/)).not.toBeInTheDocument();
  });
});

describe('this week and reassurance', () => {
  it('lists the cards of this week', () => {
    render_([thisWeek]);
    const region = screen.getByRole('region', { name: 'On this week' });
    expect(within(region).getAllByRole('listitem')).toHaveLength(4);
    expect(
      within(region).getByRole('link', { name: 'Sunset kayak on the Hudson' }),
    ).toBeInTheDocument();
  });

  it('lists the three facts', () => {
    render_([reassurance]);
    const region = screen.getByRole('region', { name: 'Booking with Ramble' });
    expect(
      within(region)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Free cancellation up to 24 hours before on most experiences',
      'Your confirmation lands in your inbox within minutes',
      'Pay with card, Apple Pay, or Google Pay',
    ]);
  });

  it('draws the icon each fact carries, whatever its place in the list', () => {
    const [check, clock, info] = homeCopy.reassurance;
    render_([
      {
        kind: 'reassurance',
        id: 'reordered',
        facts: [info, check, clock, info],
      },
    ]);
    const region = screen.getByRole('region', { name: 'Booking with Ramble' });
    expect(
      within(region)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('svg')?.getAttribute('class')),
    ).toEqual([
      expect.stringContaining('lucide-info'),
      expect.stringContaining('lucide-check'),
      expect.stringContaining('lucide-clock'),
      expect.stringContaining('lucide-info'),
    ]);
  });
});

describe('the page', () => {
  it('shows every module as a labelled region, in the order of the design', () => {
    render_();
    expect(screen.getAllByRole('region')).toHaveLength(6);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual([
      'Browse by category',
      'Rainy day, sorted',
      'Give a Saturday, not a sweater',
      'On this week',
    ]);
  });

  it('puts the modules in the order they are given', () => {
    render_([thisWeek, categoryRail]);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual(['On this week', 'Browse by category']);
  });

  it('renders nothing for no module', () => {
    const { container } = render_([]);
    expect(container).toBeEmptyDOMElement();
  });
});
