import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BookingPanelSkeleton } from './BookingPanelSkeleton';

describe('BookingPanelSkeleton', () => {
  it('says the options are loading, and hides the shapes from a screen reader', () => {
    const { container } = render(<BookingPanelSkeleton />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading booking options',
    );
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
