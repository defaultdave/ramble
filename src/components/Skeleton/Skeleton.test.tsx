import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
