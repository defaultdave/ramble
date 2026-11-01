import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SiteError from './error';
import SiteLayout from './layout';

// Behaviours: the error state of the site routes shows inside the guest frame (the layout draws it; the
// error module stays free of the frame), and its retry button calls the retry it was given.
describe('the checkout group site error state', () => {
  it('shows the notice in the main landmark of the guest frame', () => {
    render(
      <SiteLayout>
        <SiteError retry={vi.fn()} />
      </SiteLayout>,
    );

    expect(
      within(screen.getByRole('main')).getByRole('heading', {
        level: 1,
        name: 'Something went wrong on our side',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Main' }),
    ).toBeInTheDocument();
  });

  it('retries when the guest presses Try again', async () => {
    const retry = vi.fn();
    render(<SiteError retry={retry} />);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
