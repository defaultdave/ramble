import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExperienceError } from './ExperienceError';
import { ExperiencePage } from './ExperiencePage';
import {
  bareExperience,
  kidsClass,
  sunsetKayak,
} from './ExperiencePage.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - the title is the page's one h1, with the breadcrumb ending at it and the badges and prices under it
// - the key facts, the about text, the included rows, the host, and each terms section are there under their own headings
// - the meeting point is text with an "Open in Maps" link that opens in a new tab and says so
// - the Book link goes to the checkout with the experience
// - the gift entry goes to the gift checkout, and is absent when gifts are off; the private-session entry is always there and goes to contact
// - a section with nothing to say is left out whole, and the cancellation terms always stay
// - two prices name who each is for
// - the error state keeps a heading, says what went wrong, and retries with a GET form to the page's own address

describe('ExperiencePage', () => {
  it('has the title as its only h1, and a breadcrumb that ends at it', () => {
    render(<ExperiencePage view={sunsetKayak} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Sunset kayak on the Hudson',
    );
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(breadcrumb)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Tribeca', 'Outdoors', 'Sunset kayak on the Hudson']);
    expect(
      within(breadcrumb).getByRole('link', { name: 'Outdoors' }),
    ).toHaveAttribute('href', '/new-york/things-to-do/outdoors');
    expect(
      within(breadcrumb).getByText('Sunset kayak on the Hudson'),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('shows the badges, the price, and the key facts', () => {
    render(<ExperiencePage view={sunsetKayak} />);
    expect(screen.getByText('Outdoor')).toBeInTheDocument();
    expect(screen.getByText('$65').parentElement).toHaveTextContent(
      '$65 per person',
    );
    const facts = screen
      .getAllByRole('list')
      .find((list) =>
        list.textContent.includes('Weather call 3 hours before start'),
      );
    expect(
      within(facts as HTMLElement)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Tribeca',
      '2 hr',
      'Ages 14 and up',
      'Weather call 3 hours before start',
      'Free cancellation up to 24 hours before',
    ]);
  });

  it('has a heading for each section it shows', () => {
    render(<ExperiencePage view={sunsetKayak} />);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual([
      'About',
      "What's included",
      'Your host',
      'Meeting point',
      'Accessibility',
      'Weather',
      'Cancellation',
    ]);
  });

  it('lists what is included, one row each', () => {
    render(<ExperiencePage view={sunsetKayak} />);
    const section = screen
      .getByRole('heading', { name: "What's included" })
      .closest('section') as HTMLElement;
    expect(within(section).getAllByRole('listitem')).toHaveLength(4);
  });

  it('names the host and what they say', () => {
    render(<ExperiencePage view={sunsetKayak} />);
    expect(screen.getByText('Hudson Paddle Club')).toBeInTheDocument();
    expect(screen.getByText(/Six guides, all trained/)).toBeInTheDocument();
  });

  it('gives the meeting point as text with a Maps link that opens in a new tab', () => {
    render(<ExperiencePage view={sunsetKayak} />);
    expect(
      screen.getByText(/Pier 26 boathouse, Tribeca\./),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Open in Maps/ });
    expect(link).toHaveAttribute('href', sunsetKayak.meeting?.mapsHref);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('(opens in a new tab)');
  });

  it('keeps the meeting point as text when no Maps search can be made', () => {
    render(<ExperiencePage view={kidsClass} />);
    expect(
      screen.getByText(/Wheelhouse Kids Studio, ground floor/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Open in Maps/ }),
    ).not.toBeInTheDocument();
  });

  it('has a Book link to the checkout with the experience', () => {
    render(<ExperiencePage view={sunsetKayak} />);
    expect(screen.getByRole('link', { name: 'Book' })).toHaveAttribute(
      'href',
      sunsetKayak.bookHref,
    );
  });

  it('goes to the gift checkout and to contact for a private session', () => {
    render(<ExperiencePage view={sunsetKayak} />);
    expect(
      screen.getByRole('link', { name: 'Give this as a gift' }),
    ).toHaveAttribute(
      'href',
      '/gifts/checkout/00000000-0000-4000-8000-000000000001',
    );
    expect(
      screen.getByRole('link', {
        name: 'Booking for 8 or more? Ask about a private session',
      }),
    ).toHaveAttribute('href', '/contact');
  });

  it('has no gift entry while gifts are off, and keeps the private-session one', () => {
    render(<ExperiencePage view={kidsClass} />);
    expect(
      screen.queryByRole('link', { name: 'Give this as a gift' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Ask about a private session/ }),
    ).toBeInTheDocument();
  });

  it('names who each of two prices is for', () => {
    render(<ExperiencePage view={kidsClass} />);
    expect(screen.getByText('per adult')).toBeInTheDocument();
    expect(screen.getByText('per child')).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
  });

  it('leaves out each section with nothing to say, and keeps the cancellation terms', () => {
    render(<ExperiencePage view={bareExperience} />);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual(['Your host', 'Cancellation']);
    expect(
      screen.getByText(/Free cancellation up to 24 hours before start/),
    ).toBeInTheDocument();
  });

  it('shows the gallery placeholder when there is no photo', () => {
    render(<ExperiencePage view={bareExperience} />);
    expect(screen.getByText('Photos are on their way')).toBeInTheDocument();
  });
});

describe('ExperienceError', () => {
  it('keeps a heading and says what went wrong', () => {
    render(<ExperienceError retryHref="/experiences/kayak-1" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Experience',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      "We couldn't load this experience",
    );
  });

  it('retries with a GET form to the same address', () => {
    render(<ExperienceError retryHref="/experiences/kayak-1" />);
    const button = screen.getByRole('button', { name: 'Try again' });
    const form = button.closest('form');
    expect(form).toHaveAttribute('action', '/experiences/kayak-1');
    expect(form).toHaveAttribute('method', 'get');
    expect(button).toHaveAttribute('type', 'submit');
  });
});
