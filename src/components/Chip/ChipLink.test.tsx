import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChipLink } from './ChipLink';

// Behaviours under test, one per decision or branch:
// - a chip is a link to its address
// - a chosen chip is marked current; one that is not carries no mark
// - a hint is read after the label and is not drawn
// - a disabled chip is announced as unavailable and goes nowhere

describe('ChipLink', () => {
  it('links to its address', () => {
    render(
      <ChipLink label="Cooking" href="/x?category=cooking" selected={false} />,
    );
    const link = screen.getByRole('link', { name: 'Cooking' });
    expect(link).toHaveAttribute('href', '/x?category=cooking');
    expect(link).not.toHaveAttribute('aria-current');
  });

  it('marks a chosen chip as current', () => {
    render(<ChipLink label="Cooking" href="/x" selected />);
    expect(screen.getByRole('link', { name: 'Cooking' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('reads a hint after the label', () => {
    render(
      <ChipLink label="Cooking" href="/x" selected hint=", remove filter" />,
    );
    expect(
      screen.getByRole('link', { name: 'Cooking, remove filter' }),
    ).toBeVisible();
  });

  it('announces a disabled chip as unavailable and gives it no address', () => {
    render(<ChipLink label="Cooking" href="/x" selected={false} disabled />);
    const link = screen.getByRole('link', { name: 'Cooking' });
    expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(link).not.toHaveAttribute('href');
  });
});
