import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders its label', () => {
    render(<Badge tone="green" label="Outdoor" />);
    expect(screen.getByText('Outdoor')).toBeVisible();
  });

  it('renders with an unknown tone at runtime', () => {
    // @ts-expect-error content data can carry a tone the type does not know
    render(<Badge tone="purple" label="Mystery" />);
    expect(screen.getByText('Mystery')).toHaveClass(/neutral/);
  });

  it('hides the icon from assistive technology', () => {
    render(<Badge label="Kids" icon={<svg data-testid="icon" />} />);
    expect(screen.getByTestId('icon').parentElement).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});

describe('Badge props', () => {
  it('rejects className and style', () => {
    // Primitives own their styling; callers cannot override it.
    expectTypeOf<ComponentProps<typeof Badge>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof Badge>>().not.toHaveProperty('style');
  });
});
