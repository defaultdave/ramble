import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExternalLink } from './ExternalLink';

// Behaviours under test:
// - it opens in a new tab with no opener, and its name says so
// - the caller's class and other anchor attributes reach the anchor

describe('ExternalLink', () => {
  it('opens in a new tab without an opener and says so in its name', () => {
    render(
      <ExternalLink href="https://host.example/a">Read more</ExternalLink>,
    );
    const link = screen.getByRole('link', { name: /Read more/ });
    expect(link).toHaveAttribute('href', 'https://host.example/a');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAccessibleName('Read more (opens in a new tab)');
  });

  it('passes the class and other attributes to the anchor', () => {
    render(
      <ExternalLink href="/x" className="mine" data-testid="out">
        Go
      </ExternalLink>,
    );
    expect(screen.getByTestId('out')).toHaveClass('mine');
  });
});
