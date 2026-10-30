import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomeEmpty, HomeSkeleton, HomeTitle } from '.';

// Behaviours under test, one per decision, branch or risk:
// - the loading state says so to a screen reader and hides its bars
// - the loading state has the page's h1, so the page has a heading while it loads
// - the empty state keeps the heading and links to browse
// - the title for a page with no hero is a heading and nothing else

describe('HomeSkeleton', () => {
  it('announces that the page is loading', () => {
    render(<HomeSkeleton />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading the home page',
    );
  });

  it('has the page heading, out of sight', () => {
    render(<HomeSkeleton />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Ramble',
    );
  });

  it('hides its placeholder bars from assistive technology', () => {
    const { container } = render(<HomeSkeleton />);
    const bars = container.querySelectorAll('[aria-hidden="true"]');
    expect(bars.length).toBeGreaterThan(0);
  });
});

describe('HomeEmpty', () => {
  it('keeps the heading and links to browse', () => {
    render(<HomeEmpty />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Ramble',
    );
    expect(
      screen.getByRole('link', { name: 'Browse experiences' }),
    ).toHaveAttribute('href', '/new-york/browse');
  });
});

describe('HomeTitle', () => {
  it('is the page heading', () => {
    render(<HomeTitle />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Ramble',
    );
  });
});
