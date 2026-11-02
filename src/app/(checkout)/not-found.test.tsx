import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import NotFound from './not-found';

// Behaviours: the not-found state sits in the guest frame (header, footer, one main landmark reached by the
// skip link), not the bare stand-in, and the notice is inside that main.
describe('the checkout group not-found state', () => {
  it('shows the notice in the main landmark of the guest frame', () => {
    render(<NotFound />);

    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(
      within(screen.getByRole('main')).getByRole('heading', {
        level: 1,
        name: "We can't find that page",
      }),
    ).toBeInTheDocument();
  });

  it('carries the guest header, navigation, footer, and skip link', () => {
    render(<NotFound />);

    expect(
      screen.getByRole('link', { name: 'Skip to main content' }),
    ).toHaveAttribute('href', '#main');
    expect(
      screen.getByRole('navigation', { name: 'Main' }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('contentinfo')).getByRole('navigation', {
        name: 'Footer',
      }),
    ).toBeInTheDocument();
  });
});
