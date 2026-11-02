import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LandingPage, type LandingPageProps } from './LandingPage';

// Behaviours under test:
// - the page has one h1 with the heading, the intro under it, the results, and the body after them
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

  it('links to browse with the same filters', () => {
    render(<LandingPage {...props} />);

    expect(
      screen.getByRole('link', { name: 'Pick a day or narrow it down' }),
    ).toHaveAttribute('href', '/new-york/browse?category=cooking');
  });

  it('keeps the heading, the link, and the results when no copy is published', () => {
    render(<LandingPage {...props} intro={null} body={null} />);

    expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
    expect(screen.getByRole('link')).toBeVisible();
    expect(screen.getByText('6 experiences')).toBeVisible();
    expect(screen.queryByText(/Roll pasta/)).toBeNull();
    expect(screen.queryByText(/Most classes/)).toBeNull();
  });
});
