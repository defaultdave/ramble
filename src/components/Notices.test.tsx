import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { moduleClass } from '../../tests/support/moduleClass';
import buttonStyles from './Button/Button.module.css';
import { ErrorNotice } from './ErrorNotice';
import { NotFoundNotice } from './NotFoundNotice';
import { PageHeading } from './PageHeading';

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
    expect(home).toHaveClass(moduleClass(buttonStyles.primary));
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
    expect(retry).toHaveClass(moduleClass(buttonStyles.secondary));
    await userEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorNotice focus', () => {
  it('moves focus to the heading when it appears, so the failure is announced', () => {
    render(<ErrorNotice onRetry={vi.fn()} />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute('tabindex', '-1');
  });
});

describe('PageHeading', () => {
  it('stays out of the tab order unless a caller asks to move focus to it', () => {
    render(<PageHeading title="Plan your day" />);

    expect(screen.getByRole('heading', { level: 1 })).not.toHaveAttribute(
      'tabindex',
    );
  });

  it('renders the title as the level-1 heading above its children, in the page container', () => {
    render(
      <PageHeading title="Plan your day">
        <p>Pick a time</p>
      </PageHeading>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Plan your day' }),
    ).toBeInTheDocument();
    const child = screen.getByText('Pick a time');
    const container = screen.getByRole('banner');
    expect(container).toContainElement(child);
    expect(container).toContainElement(
      screen.getByRole('heading', { level: 1 }),
    );
  });
});
