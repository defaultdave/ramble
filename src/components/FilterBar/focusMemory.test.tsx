import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useFocusMemory } from './focusMemory';

// Behaviours under test, one per decision, branch or risk:
// - a removed focused element is lost focus once, when focus fell to the page
// - focus that moved to another element, or never was inside, is not claimed
// - the memory follows focus that moves within the control
// - a press outside the control forgets it, so a blur with no target (which node removal also causes) is not mistaken for focus still inside

function Harness({ showInside }: { showInside: boolean }) {
  const scope = useRef<HTMLDivElement>(null);
  const memory = useFocusMemory(scope);
  const [answers, setAnswers] = useState<string[]>([]);
  const ask = (name: string, value: boolean) => {
    setAnswers((before) => [...before, `${name}:${String(value)}`]);
  };
  return (
    <>
      <div ref={scope} onFocus={memory.onFocus} onBlur={memory.onBlur}>
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

// A synthetic click, because a real one would move focus before the question is asked.
const ask = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }));
};

describe('useFocusMemory', () => {
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

  it('forgets focus when the page is pressed outside the control', async () => {
    const { rerender } = render(<Harness showInside />);
    screen.getByRole('button', { name: 'Inside' }).focus();
    await userEvent.click(document.body);
    rerender(<Harness showInside={false} />);
    ask('Ask lost');
    ask('Ask had');
    expect(screen.getByRole('status')).toHaveTextContent(
      'lost:false had:false',
    );
  });

  it('keeps focus when the press is inside the control', async () => {
    render(<Harness showInside />);
    await userEvent.click(screen.getByRole('button', { name: 'Other inside' }));
    ask('Ask had');
    expect(screen.getByRole('status')).toHaveTextContent('had:true');
  });
});
