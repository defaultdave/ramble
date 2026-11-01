import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useDismissableDetails } from './useDismissableDetails';

// Behaviours under test:
// - Escape closes the disclosure and focuses its summary
// - Escape reaches a surrounding handler unless stopEscapePropagation is set
// - unmounting removes the document listener it added
// - a press outside closes it, even when the page stops the event in the bubble phase

function Harness({ stop }: { stop: boolean }) {
  const { details, summary, onKeyDown } = useDismissableDetails({
    stopEscapePropagation: stop,
  });
  return (
    <details ref={details} onKeyDown={onKeyDown}>
      <summary ref={summary}>Toggle</summary>
      <button type="button">Inside</button>
    </details>
  );
}

describe('useDismissableDetails', () => {
  it('closes on Escape and focuses the summary', async () => {
    render(<Harness stop={false} />);
    await userEvent.click(screen.getByText('Toggle'));
    screen.getByRole('button', { name: 'Inside' }).focus();

    await userEvent.keyboard('{Escape}');

    expect(screen.getByText('Toggle').closest('details')).not.toHaveAttribute(
      'open',
    );
    expect(screen.getByText('Toggle')).toHaveFocus();
  });

  it.each([
    [false, 1],
    [true, 0],
  ])(
    'with stopEscapePropagation %s, a surrounding handler hears Escape %i times',
    async (stop, heard) => {
      const outer = vi.fn();
      render(
        <div onKeyDown={outer}>
          <Harness stop={stop} />
        </div>,
      );
      await userEvent.click(screen.getByText('Toggle'));
      screen.getByRole('button', { name: 'Inside' }).focus();

      await userEvent.keyboard('{Escape}');

      expect(outer).toHaveBeenCalledTimes(heard);
    },
  );

  it('closes on a press outside even when the page stops the bubble', async () => {
    render(
      <>
        <button
          type="button"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
        >
          Away
        </button>
        <Harness stop={false} />
      </>,
    );
    await userEvent.click(screen.getByText('Toggle'));

    await userEvent.click(screen.getByRole('button', { name: 'Away' }));

    expect(screen.getByText('Toggle').closest('details')).not.toHaveAttribute(
      'open',
    );
  });

  it('removes its document listener, the very one it added, when unmounted', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<Harness stop={false} />);
    const added = add.mock.calls.find(([type]) => type === 'pointerdown');
    expect(added).toBeDefined();

    unmount();

    expect(remove).toHaveBeenCalledWith('pointerdown', added?.[1], added?.[2]);
    add.mockRestore();
    remove.mockRestore();
  });
});
