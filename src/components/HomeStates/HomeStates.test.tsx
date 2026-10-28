import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomeEmpty, HomeError, HomeSkeleton, HomeTitle } from '.';

// Behaviours under test, one per decision, branch or risk:
// - the loading state says so to a screen reader and hides its bars
// - the error state keeps the page heading, says what happened as an alert, and retries with a GET form to the same page
// - the empty state keeps the heading and links to browse
// - the title for a page with no hero is a heading and nothing else

describe('HomeSkeleton', () => {
  it('announces that the page is loading', () => {
    render(<HomeSkeleton />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading the home page',
    );
  });

  it('hides its placeholder bars from assistive technology', () => {
    const { container } = render(<HomeSkeleton />);
    const bars = container.querySelectorAll('[aria-hidden="true"]');
    expect(bars.length).toBeGreaterThan(0);
  });
});

describe('HomeError', () => {
  it('keeps the page heading and says what happened', () => {
    render(<HomeError />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Ramble',
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("We couldn't load the home page");
    expect(alert).toHaveTextContent('Something went wrong on our side');
  });

  it('retries with a GET form to the same page, so it works with no script', () => {
    render(<HomeError />);
    const button = screen.getByRole('button', { name: 'Try again' });
    expect(button).toHaveAttribute('type', 'submit');
    const form = button.closest('form');
    expect(form).toHaveAttribute('action', '/');
    expect(form).toHaveAttribute('method', 'get');
  });

  it('puts Try again under the alert as its own button, not inside it', () => {
    render(<HomeError />);
    const alert = screen.getByRole('alert');
    const form = screen
      .getByRole('button', { name: 'Try again' })
      .closest('form');
    expect(alert).not.toContainElement(form);
    expect(alert.parentElement).toBe(form?.parentElement);
    expect(alert.compareDocumentPosition(form as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
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
