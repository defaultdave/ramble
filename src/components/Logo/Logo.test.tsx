import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
import { Logo } from './Logo';

describe('Logo', () => {
  it('renders the wordmark', () => {
    render(<Logo />);
    expect(screen.getByText('ramble')).toBeVisible();
  });
});

describe('Logo props', () => {
  it('rejects className and style', () => {
    // Primitives own their styling; callers cannot override it.
    expectTypeOf<ComponentProps<typeof Logo>>().not.toHaveProperty('className');
    expectTypeOf<ComponentProps<typeof Logo>>().not.toHaveProperty('style');
  });
});
