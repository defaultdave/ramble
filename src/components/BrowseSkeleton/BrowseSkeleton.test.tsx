import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrowseSkeleton } from './BrowseSkeleton';

// Behaviours under test:
// - it announces that experiences are loading, once, as a status
// - it draws a page of cards and hides the drawings from assistive technology

describe('BrowseSkeleton', () => {
  it('announces the loading state', () => {
    render(<BrowseSkeleton />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading experiences');
  });

  it('draws six cards and the filter area, all hidden from assistive technology', () => {
    const { container } = render(<BrowseSkeleton />);
    const drawings = container.querySelectorAll('[aria-hidden="true"]');
    expect(drawings).toHaveLength(7);
  });
});
