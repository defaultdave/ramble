import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { landingResultsId } from '@/lib/pages/landing';
import { LandingPage, type LandingPageProps } from './LandingPage';

// Behaviours under test:
// - the page has one h1 with the heading, the intro under it, the results, and the body after them
// - with scripting off a skip link goes to the results, which sit after the footer
// - a link goes to browse with the same filters
// - with no copy published, the heading, the link, and the results remain

const props: LandingPageProps = {
  heading: 'Cooking classes in Brooklyn',
  intro: <p>Roll pasta in Carroll Gardens.</p>,
  browseHref: '/new-york/browse?category=cooking',
  results: <p>6 experiences</p>,
  body: <p>Most classes run two hours.</p>,
};

describe('LandingPage', () => {
  it('puts the heading, intro, results, and body in that order', () => {
    const { container } = render(<LandingPage {...props} />);

    expect(
      screen.getByRole('heading', { level: 1, name: props.heading }),
    ).toBeVisible();
    const text = container.textContent;
    const order = [
      'Cooking classes in Brooklyn',
      'Roll pasta',
      '6 experiences',
      'Most classes',
    ].map((part) => text.indexOf(part));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order).not.toContain(-1);
  });

  it('offers a skip link to the results for a browser with scripting off', () => {
    const markup = renderToStaticMarkup(<LandingPage {...props} />);
    const inner = /<noscript>(.*)<\/noscript>/s.exec(markup)?.[1];
    document.body.innerHTML = inner ?? '';

    expect(
      screen.getByRole('link', { name: 'Skip to results' }),
    ).toHaveAttribute('href', `#${landingResultsId}`);
    expect(markup.indexOf('<noscript>')).toBeGreaterThan(
      markup.indexOf('</header>'),
    );
    expect(markup.indexOf('<noscript>')).toBeLessThan(
      markup.indexOf('6 experiences'),
    );
  });

  it('links to browse with the same filters', () => {
    render(<LandingPage {...props} />);

    expect(
      screen.getByRole('link', { name: 'Pick a day or narrow it down' }),
    ).toHaveAttribute('href', '/new-york/browse?category=cooking');
  });

  it('keeps the heading, the link, and the results when no copy is published', () => {
    render(<LandingPage {...props} intro={null} body={null} />);

    expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Pick a day or narrow it down' }),
    ).toBeVisible();
    expect(screen.getByText('6 experiences')).toBeVisible();
    expect(screen.queryByText(/Roll pasta/)).toBeNull();
    expect(screen.queryByText(/Most classes/)).toBeNull();
  });
});
