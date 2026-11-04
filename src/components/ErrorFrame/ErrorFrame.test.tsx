import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ErrorFrame } from './ErrorFrame';

// Behaviours: the frame gives a client-drawn error state the skip link, a home link, one main landmark that
// holds the notice, and the footer navigation; it carries no site navigation.
describe('ErrorFrame', () => {
  it('holds the notice in the one main landmark that the skip link reaches', () => {
    render(
      <ErrorFrame>
        <h1>Something went wrong</h1>
      </ErrorFrame>,
    );

    expect(
      screen.getByRole('link', { name: 'Skip to main content' }),
    ).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(
      within(screen.getByRole('main')).getByRole('heading', {
        name: 'Something went wrong',
      }),
    ).toBeInTheDocument();
  });

  it('links home from the header and carries no main navigation', () => {
    render(<ErrorFrame>text</ErrorFrame>);

    expect(
      within(screen.getByRole('banner')).getByRole('link', {
        name: 'Ramble home',
      }),
    ).toHaveAttribute('href', '/');
    expect(
      screen.queryByRole('navigation', { name: 'Main' }),
    ).not.toBeInTheDocument();
  });

  it('carries the footer navigation of page groups', () => {
    render(<ErrorFrame>text</ErrorFrame>);

    expect(
      within(
        within(screen.getByRole('contentinfo')).getByRole('navigation', {
          name: 'Footer',
        }),
      ).getByRole('link', { name: 'Terms' }),
    ).toHaveAttribute('href', '/legal/terms');
  });
});
