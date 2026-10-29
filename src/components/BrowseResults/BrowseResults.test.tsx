import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { samplePhoto } from '@/components/Photo/Photo.fixtures';
import type { BrowseCard } from '@/lib/browse';
import { BrowseResults } from './BrowseResults';

// Behaviours under test, one per decision, branch or risk:
// - a bookable card and a guide-only card each render as their own kind, under level 2 headings
// - a card with a cover shows it, named by its alt text, for both kinds; a card with none keeps the empty frame
// - the summary line and the cards are in one list
// - Show more is a form that sends every field of the next address, and is absent on the last page
// - the way back to the first results is there only on a later page
// - empty says whether a filter is on and offers Clear all filters only then
// - empty on a chosen day names the day and links to the next day with experiences and to any day, or only to any day when none follows; Clear all filters is offered only when another filter is on
// - an error is announced as an alert with a Try again form that carries the same address
// - an outdated cursor says so and links to the first results
// - the results heading takes focus when the control that was focused has gone, and never on the first paint or while focus is on something that stays

vi.mock('next/form', () => ({
  default: ({
    action,
    children,
    className,
  }: {
    action: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <form action={action} method="get" className={className}>
      {children}
    </form>
  ),
}));

const cards: BrowseCard[] = [
  {
    id: '1',
    image: null,
    kind: 'bookable',
    title: 'Hand-rolled pasta',
    meta: 'Carroll Gardens · 2.5 hr',
    href: '/experiences/pasta-1',
    price: 'From $60',
  },
  {
    id: '2',
    image: null,
    kind: 'guide-only',
    title: 'Sourdough mornings',
    meta: 'Park Slope',
    href: '/guide/sourdough-2',
    hostHref: 'https://host.example/sourdough',
  },
];

const next = {
  action: '/new-york/browse',
  fields: [
    ['category', 'cooking'],
    ['after', 'abc'],
  ],
} as const;

describe('BrowseResults cover photos', () => {
  const view = (covered: BrowseCard[]) =>
    ({
      state: 'results',
      cards: covered,
      summary: '2 experiences',
      showMore: null,
      startHref: null,
    }) as const;

  it('shows the cover of a bookable card and of a guide entry, named by its alt text', () => {
    render(
      <BrowseResults
        {...view(
          cards.map((card, index) => ({ ...card, image: samplePhoto(index) })),
        )}
      />,
    );
    expect(screen.getByRole('img', { name: 'Photo 1' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Photo 2' })).toBeInTheDocument();
  });

  it('shows no image for a card with no cover', () => {
    render(<BrowseResults {...view(cards)} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('BrowseResults results', () => {
  const results = {
    state: 'results',
    cards,
    summary: 'Showing 2 experiences',
    showMore: next,
    startHref: null,
  } as const;

  it('lists each card as its own kind under a level 2 heading', () => {
    render(<BrowseResults {...results} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(
      within(items[0] as HTMLElement).getByRole('heading', { level: 2 }),
    ).toHaveTextContent('Hand-rolled pasta');
    expect(items[0]).toHaveTextContent('From $60 per person');
    expect(items[1]).toHaveTextContent('Not bookable on Ramble yet');
    expect(
      within(items[1] as HTMLElement).getByRole('link', {
        name: /Visit host site/,
      }),
    ).toHaveAttribute('href', 'https://host.example/sourdough');
  });

  it('shows the summary line as the level 2 heading over the results', () => {
    render(<BrowseResults {...results} />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Showing 2 experiences' }),
    ).toBeVisible();
  });

  it('sends the whole next address from Show more', () => {
    render(<BrowseResults {...results} />);
    const button = screen.getByRole('button', { name: 'Show more' });
    const form = button.closest('form');
    expect(form).toHaveAttribute('action', '/new-york/browse');
    expect(form?.method).toBe('get');
    const fields = Array.from(
      form?.querySelectorAll<HTMLInputElement>('input[type="hidden"]') ?? [],
    ).map((input) => [input.name, input.value]);
    expect(fields).toEqual([
      ['category', 'cooking'],
      ['after', 'abc'],
    ]);
  });

  it('has no Show more on the last page', () => {
    render(<BrowseResults {...results} showMore={null} />);
    expect(
      screen.queryByRole('button', { name: 'Show more' }),
    ).not.toBeInTheDocument();
  });

  it('has no way back on the first page', () => {
    render(<BrowseResults {...results} />);
    expect(
      screen.queryByRole('link', { name: 'Back to the first results' }),
    ).not.toBeInTheDocument();
  });

  it('links back to the first results on a later page', () => {
    render(
      <BrowseResults
        {...results}
        startHref="/new-york/browse?category=cooking"
      />,
    );
    expect(
      screen.getByRole('link', { name: 'Back to the first results' }),
    ).toHaveAttribute('href', '/new-york/browse?category=cooking');
  });
});

describe('BrowseResults empty', () => {
  it('says nothing matches and offers to clear when a filter is on', () => {
    render(<BrowseResults state="empty" filtered dated={null} />);
    expect(
      screen.getByRole('heading', { name: 'Nothing matches those filters' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Clear all filters' }),
    ).toHaveAttribute('href', '/new-york/browse');
  });

  it('says there is nothing yet, with nothing to clear, when no filter is on', () => {
    render(<BrowseResults state="empty" filtered={false} dated={null} />);
    expect(
      screen.getByRole('heading', { name: 'Nothing to browse yet' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'Clear all filters' }),
    ).not.toBeInTheDocument();
  });
});

describe('BrowseResults empty on a chosen day', () => {
  const dated = {
    dateLabel: 'Sat, Nov 7',
    nextDay: {
      label: 'Mon, Nov 9',
      href: '/new-york/browse?category=cooking&date=2026-11-09',
    },
    anyDayHref: '/new-york/browse?category=cooking',
    message: 'The next day with experiences is Mon, Nov 9.',
  };

  it('names the day and links to the next day with experiences and to any day', () => {
    render(<BrowseResults state="empty" filtered dated={dated} />);
    expect(
      screen.getByRole('heading', { name: 'Nothing on Sat, Nov 7' }),
    ).toBeVisible();
    expect(
      screen.getByText('The next day with experiences is Mon, Nov 9.'),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'See Mon, Nov 9' }),
    ).toHaveAttribute(
      'href',
      '/new-york/browse?category=cooking&date=2026-11-09',
    );
    expect(screen.getByRole('link', { name: 'Any day' })).toHaveAttribute(
      'href',
      '/new-york/browse?category=cooking',
    );
    expect(
      screen.queryByRole('link', { name: 'Clear all filters' }),
    ).not.toBeInTheDocument();
  });

  it('offers only any day when no later day has experiences', () => {
    render(
      <BrowseResults
        state="empty"
        filtered
        dated={{
          ...dated,
          nextDay: null,
          message: 'There are no experiences on later days.',
        }}
      />,
    );
    expect(
      screen.getByText('There are no experiences on later days.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('link', { name: /^See / }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Any day' })).toBeVisible();
  });
});

describe('BrowseResults error', () => {
  it('announces the failure and retries the same address', () => {
    render(<BrowseResults state="error" retry={next} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("We couldn't load experiences");
    expect(alert).toHaveTextContent(
      'Something went wrong on our side. Your filters are saved.',
    );
    const retry = screen.getByRole('button', { name: 'Try again' });
    // Inside the alert the button would lose its styles and read as a link.
    expect(alert).not.toContainElement(retry);
    const form = retry.closest('form');
    expect(form).toHaveAttribute('action', '/new-york/browse');
    expect(form?.querySelectorAll('input[type="hidden"]')).toHaveLength(2);
  });
});

describe('BrowseResults outdated', () => {
  it('links to the first results', () => {
    render(
      <BrowseResults
        state="outdated"
        startHref="/new-york/browse?date=2026-11-07"
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'That page of results has moved' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Back to the first results' }),
    ).toHaveAttribute('href', '/new-york/browse?date=2026-11-07');
  });
});

describe('BrowseResults focus', () => {
  const empty = {
    state: 'empty',
    filtered: true,
    dated: {
      dateLabel: 'Sat, Nov 7',
      nextDay: {
        label: 'Mon, Nov 9',
        href: '/new-york/browse?date=2026-11-09',
      },
      anyDayHref: '/new-york/browse',
      message: 'The next day with experiences is Mon, Nov 9.',
    },
  } as const;
  const results = {
    state: 'results',
    cards: [] as BrowseCard[],
    summary: '3 experiences',
    showMore: null,
    startHref: null,
  } as const;

  beforeEach(() => {
    vi.resetModules();
  });

  async function load() {
    return (await import('./BrowseResults')).BrowseResults;
  }

  it('leaves focus alone on the first paint', async () => {
    const Results = await load();
    render(<Results {...empty} />);
    expect(document.body).toHaveFocus();
  });

  it('moves focus to the new heading when the focused link went with the old results', async () => {
    const Results = await load();
    const { rerender } = render(<Results {...empty} />);
    const link = screen.getByRole('link', { name: 'See Mon, Nov 9' });
    link.focus();
    expect(link).toHaveFocus();
    rerender(<Results {...results} />);
    expect(link).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: '3 experiences' }),
    ).toHaveFocus();
  });

  it('keeps focus on a control outside the results', async () => {
    const Results = await load();
    const { rerender } = render(
      <>
        <button type="button">Chip</button>
        <Results {...empty} />
      </>,
    );
    screen.getByRole('button', { name: 'Chip' }).focus();
    rerender(
      <>
        <button type="button">Chip</button>
        <Results {...results} />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Chip' })).toHaveFocus();
  });
});
