import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useDismissableDetails } from './useDismissableDetails';

// Behaviours under test:
// - Escape closes the disclosure and focuses its summary
// - Escape reaches a surrounding handler unless stopEscapePropagation is set
// - unmounting removes the document listener it added
// - a press outside closes it, even when the page stops the event in the bubble phase
// - Tab out to another element closes it; Tab within, and focus that goes to nothing (relatedTarget null), leave it open
// - a click on a link inside closes it, also on an element inside the link; a click on other content does not

function Harness({ stop }: { stop: boolean }) {
  const { details, summary, onKeyDown, onBlur, onClick } =
    useDismissableDetails({ stopEscapePropagation: stop });
  return (
    <details
      ref={details}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onClick={onClick}
    >
      <summary ref={summary}>Toggle</summary>
      <button type="button">Inside</button>
      <a href="#target">
        <span>Go</span>
      </a>
      <p>Words</p>
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

  describe('when focus leaves', () => {
    const isOpen = () =>
      screen.getByText('Toggle').closest('details')?.hasAttribute('open');

    it('closes on Tab out to another element', async () => {
      render(
        <>
          <Harness stop={false} />
          <button type="button">After</button>
        </>,
      );
      await userEvent.click(screen.getByText('Toggle'));
      screen.getByRole('link').focus();

      await userEvent.tab();

      expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
      expect(isOpen()).toBe(false);
    });

    it('stays open on Tab to another element inside', async () => {
      render(<Harness stop={false} />);
      await userEvent.click(screen.getByText('Toggle'));
      screen.getByRole('button', { name: 'Inside' }).focus();

      await userEvent.tab();

      expect(screen.getByRole('link')).toHaveFocus();
      expect(isOpen()).toBe(true);
    });

    it('stays open when focus goes to nothing', async () => {
      render(<Harness stop={false} />);
      await userEvent.click(screen.getByText('Toggle'));
      const inside = screen.getByRole('button', { name: 'Inside' });
      inside.focus();

      act(() => {
        inside.blur();
      });

      expect(isOpen()).toBe(true);
    });
  });

  describe('when a click lands inside', () => {
    it('closes on a link, even on an element inside the link', async () => {
      render(<Harness stop={false} />);
      await userEvent.click(screen.getByText('Toggle'));

      await userEvent.click(screen.getByText('Go'));

      expect(screen.getByText('Toggle').closest('details')).not.toHaveAttribute(
        'open',
      );
    });

    it('stays open on other content', async () => {
      render(<Harness stop={false} />);
      await userEvent.click(screen.getByText('Toggle'));

      await userEvent.click(screen.getByText('Words'));

      expect(screen.getByText('Toggle').closest('details')).toHaveAttribute(
        'open',
      );
    });
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
