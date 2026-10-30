import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageError } from '.';

// Behaviours under test, one per decision, branch or risk:
// - the page keeps the title it was given as its only h1
// - the alert says what happened, with the title and body it was given
// - Try again is a GET form to the address it was given, so it works with no script
// - Try again sits under the alert as its own button, not inside it

const props = {
  title: 'Experience',
  alertTitle: "We couldn't load this experience",
  alertBody: 'Something went wrong on our side. Try again in a moment.',
  retryHref: '/experiences/kayak-1',
};

describe('PageError', () => {
  it('keeps the given title as the only h1', () => {
    render(<PageError {...props} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Experience',
    );
  });

  it('says what happened in a danger alert', () => {
    render(<PageError {...props} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("We couldn't load this experience");
    expect(alert).toHaveTextContent('Something went wrong on our side');
  });

  it.each(['/', '/experiences/kayak-1'])(
    'retries with a GET form to %s',
    (retryHref) => {
      render(<PageError {...props} retryHref={retryHref} />);
      const button = screen.getByRole('button', { name: 'Try again' });
      expect(button).toHaveAttribute('type', 'submit');
      const form = button.closest('form');
      expect(form).toHaveAttribute('action', retryHref);
      expect(form).toHaveAttribute('method', 'get');
    },
  );

  it('puts Try again under the alert as its own button, not inside it', () => {
    render(<PageError {...props} />);
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
