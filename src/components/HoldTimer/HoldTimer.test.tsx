import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
import { HoldTimer } from './HoldTimer';

const now = new Date('2026-11-02T15:00:00.000Z');

function timer(secondsLeft: number) {
  return (
    <HoldTimer
      now={now}
      expiresAt={new Date(now.getTime() + secondsLeft * 1000)}
    />
  );
}

describe('HoldTimer', () => {
  it.each([
    { secondsLeft: 582, text: 'Spaces held for 9:42' },
    { secondsLeft: 72, text: 'Spaces held for 1:12' },
    { secondsLeft: 0, text: 'Hold expired' },
  ])('$secondsLeft seconds reads "$text"', ({ secondsLeft, text }) => {
    render(timer(secondsLeft));
    expect(screen.getByRole('timer')).toHaveTextContent(text);
  });

  it('keeps its announcement empty while the hold is long', () => {
    render(timer(582));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('announces at the five minute mark, not on every tick', () => {
    const { rerender } = render(timer(300));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your hold ends in 5 minutes.',
    );
    rerender(timer(299));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your hold ends in 5 minutes.',
    );
  });

  it('announces expiry', () => {
    render(timer(0));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your hold has expired.',
    );
  });

  it('reads as expired, with no time left, for an invalid expiry', () => {
    render(<HoldTimer now={now} expiresAt={new Date(Number.NaN)} />);
    expect(screen.getByRole('timer')).toHaveTextContent('Hold expired');
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
