import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import CheckoutError from './error';
import CheckoutLayout from './layout';

// Behaviours: the checkout page's error state shows in the checkout frame (skip link, header, footer, one
// main landmark reached by the skip link), and its retry button calls the retry it was given.
describe('the checkout page error state', () => {
  it('shows the notice in the main landmark of the checkout frame', () => {
    render(
      <CheckoutLayout>
        <CheckoutError retry={vi.fn()} />
      </CheckoutLayout>,
    );

    expect(
      screen.getByRole('link', { name: 'Skip to main content' }),
    ).toHaveAttribute('href', '#main');
    expect(screen.getByText('Secure checkout')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(
      within(screen.getByRole('main')).getByRole('heading', {
        level: 1,
        name: 'Something went wrong on our side',
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('contentinfo')).getByRole('navigation', {
        name: 'Footer',
      }),
    ).toBeInTheDocument();
  });

  it('retries when the guest presses Try again', async () => {
    const retry = vi.fn();
    render(<CheckoutError retry={retry} />);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
