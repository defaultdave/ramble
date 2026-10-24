import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { describe, expect, it, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
import { Skeleton, type SkeletonKind } from './Skeleton';

describe('Skeleton', () => {
  it.each(['card', 'horizontal-card', 'text'] satisfies SkeletonKind[])(
    '%s is hidden from assistive technology',
    (kind) => {
      const { container } = render(<Skeleton kind={kind} />);
      expect(container.firstElementChild).toHaveAttribute(
        'aria-hidden',
        'true',
      );
    },
  );
});

describe('Skeleton props', () => {
  it('rejects className and style', () => {
    // Primitives own their styling; callers cannot override it.
    expectTypeOf<ComponentProps<typeof Skeleton>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof Skeleton>>().not.toHaveProperty('style');
  });
});
