import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostSuspension } from './HostSuspension';

// Behaviours under test:
// - a host with live experiences offers Suspend, names how many it would pause, and carries the host id
// - a host with experiences a suspension paused offers Unsuspend, names how many, and says anything paused by hand stays paused
// - a host with neither offers neither and says so
// - both can show at once, and a count of one is singular

const noop = () => undefined;
const hostId = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';

function renderFor(liveCount: number, suspendedCount: number) {
  return render(
    <HostSuspension
      hostId={hostId}
      suspension={{ liveCount, suspendedCount }}
      suspend={noop}
      unsuspend={noop}
    />,
  );
}

describe('HostSuspension', () => {
  it('offers Suspend for live experiences, naming how many and carrying the host', () => {
    const { container } = renderFor(3, 0);

    expect(
      screen.getByRole('button', { name: 'Suspend host' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/pauses 3 experiences that are live/),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Unsuspend host' }),
    ).not.toBeInTheDocument();
    expect(container.querySelector('input[name="hostId"]')).toHaveValue(hostId);
  });

  it('offers Unsuspend for the experiences a suspension paused, and says a hand pause stays', () => {
    renderFor(0, 2);

    expect(
      screen.getByRole('button', { name: 'Unsuspend host' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/the 2 experiences paused by a suspension/),
    ).toBeVisible();
    expect(screen.getByText(/paused by hand stays paused/)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Suspend host' }),
    ).not.toBeInTheDocument();
  });

  it('offers neither when there is nothing to do, and says so', () => {
    renderFor(0, 0);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/no live experiences/)).toBeVisible();
  });

  it('offers both when both apply, and a count of one is singular', () => {
    renderFor(1, 1);

    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText(/pauses 1 experience that is live/)).toBeVisible();
  });
});
