import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { describe, expect, it, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
import { Illustration } from './Illustration';

describe('Illustration', () => {
  it('is decorative, hidden from assistive technology', () => {
    const { container } = render(<Illustration />);
    expect(container.querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('gives each instance its own clip path id', () => {
    const { container } = render(
      <>
        <Illustration />
        <Illustration />
      </>,
    );
    const ids = [...container.querySelectorAll('clipPath')].map(
      (clip) => clip.id,
    );
    expect(new Set(ids).size).toBe(2);
  });
});

describe('Illustration props', () => {
  it('rejects className and style', () => {
    expectTypeOf<ComponentProps<typeof Illustration>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof Illustration>>().not.toHaveProperty(
      'style',
    );
  });
});
