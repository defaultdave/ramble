import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { focusFellToPage, useFocusMemory } from './focusMemory';

// Behaviours under test, one per decision, branch or risk:
// - nothing remembered, or the remembered element still on the page, is not lost focus
// - a removed element is lost focus only when focus is on the page itself, not when it went elsewhere
// - the memory follows focus into the control and forgets it when focus leaves for something outside
// - focusWasLost and hadFocus each answer true once

function Harness({ showInside }: { showInside: boolean }) {
  const memory = useFocusMemory();
  const [answers, setAnswers] = useState<string[]>([]);
  const ask = (name: string, value: boolean) => {
    setAnswers((before) => [...before, `${name}:${String(value)}`]);
  };
  return (
    <>
      <div onFocus={memory.onFocus} onBlur={memory.onBlur}>
        {showInside ? <button type="button">Inside</button> : null}
        <button type="button">Other inside</button>
      </div>
      <button type="button">Outside</button>
      <button
        type="button"
        onClick={() => {
          ask('lost', memory.focusWasLost());
        }}
      >
        Ask lost
      </button>
      <button
        type="button"
        onClick={() => {
          ask('had', memory.hadFocus());
        }}
      >
        Ask had
      </button>
      <output>{answers.join(' ')}</output>
    </>
  );
}

describe('focusFellToPage', () => {
  it('is false with nothing remembered', () => {
    expect(focusFellToPage(null)).toBe(false);
  });

  it('is false while the element is still on the page', () => {
    render(<button type="button">Here</button>);
    expect(focusFellToPage(screen.getByRole('button'))).toBe(false);
  });

  it('is true for a removed element when focus is on the page', () => {
    expect(focusFellToPage(document.createElement('button'))).toBe(true);
  });

  it('is false for a removed element when focus moved to another element', () => {
    render(<button type="button">Elsewhere</button>);
    screen.getByRole('button').focus();
    expect(focusFellToPage(document.createElement('button'))).toBe(false);
  });
});

describe('useFocusMemory', () => {
  // A synthetic click, because a real one would move focus before the question is asked.
  const ask = (name: string) => {
    fireEvent.click(screen.getByRole('button', { name }));
  };

  it('knows focus was lost when the focused element is removed, once', () => {
    const { rerender } = render(<Harness showInside />);
    screen.getByRole('button', { name: 'Inside' }).focus();
    rerender(<Harness showInside={false} />);
    ask('Ask lost');
    ask('Ask lost');
    expect(screen.getByRole('status')).toHaveTextContent(
      'lost:true lost:false',
    );
  });

  it('does not claim focus that moved outside', () => {
    const { rerender } = render(<Harness showInside />);
    screen.getByRole('button', { name: 'Inside' }).focus();
    screen.getByRole('button', { name: 'Outside' }).focus();
    rerender(<Harness showInside={false} />);
    ask('Ask lost');
    ask('Ask had');
    expect(screen.getByRole('status')).toHaveTextContent(
      'lost:false had:false',
    );
  });

  it('does not claim focus that was never inside', () => {
    render(<Harness showInside />);
    ask('Ask lost');
    ask('Ask had');
    expect(screen.getByRole('status')).toHaveTextContent(
      'lost:false had:false',
    );
  });

  it('keeps following focus that moves within the control, and answers once', async () => {
    render(<Harness showInside />);
    screen.getByRole('button', { name: 'Inside' }).focus();
    await userEvent.tab();
    ask('Ask had');
    ask('Ask had');
    expect(screen.getByRole('status')).toHaveTextContent('had:true had:false');
  });
});
