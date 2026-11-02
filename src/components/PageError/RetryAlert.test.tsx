import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RetryAlert } from './RetryAlert';

// Behaviours under test, one per decision, branch or risk:
// - the alert says what happened with the title and body it was given
// - the retry control it was given sits outside the alert, so it keeps its button styles

describe('RetryAlert', () => {
  it('shows the alert and puts the retry control beside it, not inside', () => {
    render(
      <RetryAlert alertTitle="It broke" alertBody="Try again in a moment.">
        <button type="submit">Try again</button>
      </RetryAlert>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('It broke');
    expect(alert).toHaveTextContent('Try again in a moment.');
    expect(alert).not.toContainElement(
      screen.getByRole('button', { name: 'Try again' }),
    );
  });
});
