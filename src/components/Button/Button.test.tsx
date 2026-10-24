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
