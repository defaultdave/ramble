import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import GroupError from './error';

// Behaviours: the group error state sits in a styled frame (skip link, home link, footer, one main landmark),
// not the bare stand-in, and its retry button calls the retry it was given.
describe('the checkout group error state', () => {
  it('shows the notice in the main landmark of the frame', () => {
    render(<GroupError retry={vi.fn()} />);

    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(
      within(screen.getByRole('main')).getByRole('heading', {
        level: 1,
        name: 'Something went wrong on our side',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Skip to main content' }),
    ).toHaveAttribute('href', '#main');
    expect(
      within(screen.getByRole('contentinfo')).getByRole('navigation', {
        name: 'Footer',
      }),
    ).toBeInTheDocument();
  });

  it('retries when the guest presses Try again', async () => {
    const retry = vi.fn();
    render(<GroupError retry={retry} />);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
