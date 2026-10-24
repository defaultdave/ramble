import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
import { HoldTimer } from './HoldTimer';

describe('HoldTimer', () => {
  it.each([
    { secondsRemaining: 582, text: 'Spaces held for 9:42' },
    { secondsRemaining: 72, text: 'Spaces held for 1:12' },
    { secondsRemaining: 0, text: 'Hold expired' },
  ])(
    '$secondsRemaining seconds reads "$text"',
    ({ secondsRemaining, text }) => {
      render(<HoldTimer secondsRemaining={secondsRemaining} />);
      expect(screen.getByRole('timer')).toHaveTextContent(text);
    },
  );

  it('keeps its announcement empty while the hold is long', () => {
    render(<HoldTimer secondsRemaining={582} />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('announces at the five minute mark, not on every tick', () => {
    const { rerender } = render(<HoldTimer secondsRemaining={300} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your hold ends in 5 minutes.',
    );
    rerender(<HoldTimer secondsRemaining={299} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your hold ends in 5 minutes.',
    );
  });

  it('announces expiry', () => {
    render(<HoldTimer secondsRemaining={0} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your hold has expired.',
    );
  });
});

describe('HoldTimer props', () => {
  it('rejects className, style, and role', () => {
    expectTypeOf<ComponentProps<typeof HoldTimer>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof HoldTimer>>().not.toHaveProperty(
      'style',
    );
    expectTypeOf<ComponentProps<typeof HoldTimer>>().not.toHaveProperty('role');
  });
});
