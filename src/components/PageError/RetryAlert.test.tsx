import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { moduleClass } from '../../../tests/support/moduleClass';
import { RetryAlert } from './RetryAlert';
import styles from './RetryAlert.module.css';

// Behaviours under test, one per decision, branch or risk:
// - the alert says what happened with the title and body it was given
// - fit marks the wrapper so the alert can shrink to its content, and the default leaves it stretching
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

  it.each([
    [true, true],
    [false, false],
  ])('with fit=%s the wrapper fit class is %s', (fit, marked) => {
    const { container } = render(
      <RetryAlert alertTitle="t" alertBody="b" fit={fit}>
        <button type="submit">Try again</button>
      </RetryAlert>,
    );
    const wrapper = container.firstElementChild;
    if (!wrapper) throw new Error('The alert did not render');
    expect(wrapper.classList.contains(moduleClass(styles.fit))).toBe(marked);
  });
});
