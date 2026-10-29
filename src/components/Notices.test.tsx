import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorNotice } from './ErrorNotice';
import { NotFoundNotice } from './NotFoundNotice';

describe('NotFoundNotice', () => {
  it('names the page as missing and offers the home page as a library button', () => {
    render(<NotFoundNotice />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: "We can't find that page",
      }),
    ).toBeInTheDocument();
    const home = screen.getByRole('link', {
      name: 'Go to the Ramble home page',
    });
    expect(home).toHaveAttribute('href', '/');
    expect(home.className).toMatch(/primary/);
  });
});

describe('ErrorNotice', () => {
  it('says what happened and retries when asked', async () => {
    const onRetry = vi.fn();
    render(<ErrorNotice onRetry={onRetry} />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Something went wrong on our side',
      }),
    ).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry.className).toMatch(/secondary/);
    await userEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
