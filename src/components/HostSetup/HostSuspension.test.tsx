import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HostSuspension as Suspension } from '@/lib/experiencePause';
import { HostSuspension } from './HostSuspension';

// Behaviours under test:
// - a host that is not suspended offers Suspend only, says what it would do, and carries the host id
// - a suspended host says so and offers Unsuspend only, saying what it would undo and that a hand pause stays
// - the sentences themselves are tested in the lib; here only that the right one is shown

const noop = () => undefined;
const hostId = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';

function renderFor(suspension: Suspension) {
  return render(
    <HostSuspension
      hostId={hostId}
      suspension={suspension}
      suspend={noop}
      unsuspend={noop}
    />,
  );
}

describe('HostSuspension', () => {
  it('offers Suspend for a host that is not suspended, naming how many it would pause and carrying the host', () => {
    const { container } = renderFor({
      suspended: false,
      liveCount: 3,
      suspendedCount: 0,
    });

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

  it('still offers Suspend for a host with nothing live, saying it records the suspension', () => {
    renderFor({ suspended: false, liveCount: 0, suspendedCount: 0 });

    expect(
      screen.getByRole('button', { name: 'Suspend host' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/records the suspension/)).toBeVisible();
  });

  it('says a host is suspended and offers Unsuspend only, naming what it would undo', () => {
    renderFor({ suspended: true, liveCount: 0, suspendedCount: 2 });

    expect(screen.getByText('This host is suspended.')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Unsuspend host' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/the 2 experiences paused by the suspension/),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Suspend host' }),
    ).not.toBeInTheDocument();
  });
});
