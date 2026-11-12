import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActionNotice } from './ActionNotice';

// Behaviours under test:
// - a notice shows its title, and a warning or error as an alert that interrupts
// - a confirmation waits its turn as a status
// - no notice shows nothing

describe('ActionNotice', () => {
  it('shows a confirmation as a status', () => {
    render(<ActionNotice notice={{ tone: 'success', title: 'Saved.' }} />);

    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  });

  it('shows a refusal as an alert', () => {
    render(<ActionNotice notice={{ tone: 'danger', title: 'Not saved.' }} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Not saved.');
  });

  it('shows nothing for no notice', () => {
    const { container } = render(<ActionNotice notice={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
