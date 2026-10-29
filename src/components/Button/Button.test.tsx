import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
import { Button } from './Button';

describe('Button', () => {
  it('renders its label as the accessible name', () => {
    render(<Button>Book now</Button>);
    expect(screen.getByRole('button', { name: 'Book now' })).toBeVisible();
  });

  it('fires onClick when enabled', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Book now</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire onClick when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Book now
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is busy, keeps its label, and ignores clicks while loading', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Book now
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Book now' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('stays focusable and keeps focus when loading starts', () => {
    const { rerender } = render(<Button>Book now</Button>);
    const button = screen.getByRole('button', { name: 'Book now' });
    button.focus();
    rerender(<Button loading>Book now</Button>);
    expect(button).toHaveFocus();
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('blocks %s while loading', async (_name, keys) => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Book now
      </Button>,
    );
    screen.getByRole('button').focus();
    await userEvent.keyboard(keys);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not submit a form while loading', async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => {
      event.preventDefault();
    });
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading>
          Book now
        </Button>
      </form>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('is natively disabled, not aria-disabled, when disabled and idle', () => {
    render(<Button disabled>Book now</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute('aria-disabled');
  });

  it('defaults to type button so it never submits a form by accident', () => {
    render(<Button>Book now</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('passes native props through', () => {
    render(<Button name="book" aria-label="Book" />);
    expect(screen.getByRole('button', { name: 'Book' })).toHaveAttribute(
      'name',
      'book',
    );
  });
});

describe('Button props', () => {
  it('rejects className and style', () => {
    // Primitives own their styling; callers cannot override it.
    expectTypeOf<ComponentProps<typeof Button>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof Button>>().not.toHaveProperty('style');
  });
});
