import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FlashMessage } from '@/lib/flash';
import { Flash } from './Flash';

// Behaviours under test, one per decision, branch or risk:
// - no flash shows nothing
// - a good-news or neutral flash waits its turn (status); a warning or error interrupts (alert)

describe('Flash', () => {
  it('shows nothing without a flash', () => {
    const { container } = render(<Flash flash={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['success', 'status'],
    ['info', 'status'],
    ['warning', 'alert'],
    ['danger', 'alert'],
  ] as const satisfies readonly [FlashMessage['tone'], string][])(
    'shows a %s flash as a %s',
    (tone, role) => {
      render(<Flash flash={{ tone, message: 'Order refunded.' }} />);
      expect(screen.getByRole(role)).toHaveTextContent('Order refunded.');
    },
  );
});
