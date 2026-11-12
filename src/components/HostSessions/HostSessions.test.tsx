import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostSessionFormState } from '@/lib/hostSessions';
import type { HostSessionActions } from './HostSessionForms';
import { HostSessions } from './HostSessions';
import { emptyWeek, week } from './HostSessions.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - one heading, the week and its links (a link that is null is not drawn), and the zone the times are in
// - sessions are grouped under their day with time, status, seats sold and price
// - an unbooked session offers capacity, price, time and cancel; a booked one offers capacity and price and says why time is locked;
//   a cancelled one offers nothing
// - a form posts its hidden ids and version with what was typed, and the answer is shown in words
// - a refused field is marked with its message; a refusal and a failure each show a notice
// - with no actions (read-only staff) the week is shown with no form, button, publish or one-off section
// - publishing posts the week it was drawn for; the one-off form is there only when the host has experiences

const reply =
  vi.fn<
    (
      previous: HostSessionFormState,
      data: FormData,
    ) => Promise<HostSessionFormState>
  >();
const actions: HostSessionActions = {
  publishWeek: reply,
  updateCapacity: reply,
  updateTime: reply,
  updatePrice: reply,
  cancelSession: reply,
  addOneOff: reply,
};

beforeEach(() => {
  reply.mockReset();
  reply.mockResolvedValue({ status: 'done', message: 'Saved.' });
});

const rowFor = (name: string, time: string) =>
  screen
    .getAllByRole('listitem')
    .find(
      (item) =>
        item.textContent.includes(name) && item.textContent.includes(time),
    ) as HTMLElement;

describe('HostSessions', () => {
  it('shows the week, its links and the zone', () => {
    render(<HostSessions view={week} actions={actions} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Sessions' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Mon, Nov 9 to Sun, Nov 15')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Previous week' })).toHaveAttribute(
      'href',
      '/host/sessions?week=2026-11-02',
    );
    expect(screen.getByRole('link', { name: 'Next week' })).toHaveAttribute(
      'href',
      '/host/sessions?week=2026-11-16',
    );
    expect(
      screen.queryByRole('link', { name: 'This week' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Times are in America\/New_York/)).toBeVisible();
  });

  it('shows read-only staff the week with nothing to change', () => {
    render(<HostSessions view={week} actions={null} />);
    const row = rowFor('Sunset kayak', '4:00 PM EST');
    expect(row).toBeVisible();
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Publish|Add/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Publish this week' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Add a one-off session' }),
    ).not.toBeInTheDocument();
  });

  it('groups sessions under their day', () => {
    render(<HostSessions view={week} actions={actions} />);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Sat, Nov 14' }),
    ).toBeInTheDocument();
    const row = rowFor('Harbor tour', '10:00 AM EST');
    expect(row).toHaveTextContent('4 of 8 seats sold');
    expect(row).toHaveTextContent('$85 adult');
  });

  it('offers every change on an unbooked session', () => {
    render(<HostSessions view={week} actions={actions} />);
    const row = rowFor('Sunset kayak', '4:00 PM EST');
    for (const name of [
      'Save capacity',
      'Save price',
      'Save time',
      'Cancel this session',
    ]) {
      expect(within(row).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('locks the time and cancel of a booked session, and says why', () => {
    render(<HostSessions view={week} actions={actions} />);
    const row = rowFor('Harbor tour', '10:00 AM EST');
    expect(
      within(row).getByRole('button', { name: 'Save capacity' }),
    ).toBeInTheDocument();
    expect(
      within(row).queryByRole('button', { name: 'Save time' }),
    ).not.toBeInTheDocument();
    expect(
      within(row).queryByRole('button', { name: 'Cancel this session' }),
    ).not.toBeInTheDocument();
    expect(row).toHaveTextContent('Seats are booked');
  });

  it('offers nothing on a cancelled session', () => {
    render(<HostSessions view={week} actions={actions} />);
    const row = rowFor('Sunset kayak', 'Cancelled');
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  });

  it('posts the ids, the version and what was typed, and shows the answer', async () => {
    const user = userEvent.setup();
    render(<HostSessions view={week} actions={actions} />);
    const row = rowFor('Sunset kayak', '4:00 PM EST');
    const field = within(row).getByLabelText('Capacity (seats)');
    await user.clear(field);
    await user.type(field, '12');
    await user.click(
      within(row).getByRole('button', { name: 'Save capacity' }),
    );

    const data = reply.mock.calls[0]?.[1];
    expect([
      data?.get('sessionId'),
      data?.get('expectedVersion'),
      data?.get('allocation'),
    ]).toEqual(['00000000-0000-4000-8000-000000000001', '1', '12']);
    expect(await within(row).findByText('Saved.')).toBeInTheDocument();
  });

  it('marks a refused field with its message and moves focus to it', async () => {
    reply.mockResolvedValue({
      status: 'invalid',
      errors: { allocation: 'Enter a whole number of seats, from 0 to 1000.' },
    });
    const user = userEvent.setup();
    render(<HostSessions view={week} actions={actions} />);
    const row = rowFor('Sunset kayak', '4:00 PM EST');
    await user.click(
      within(row).getByRole('button', { name: 'Save capacity' }),
    );

    const field = await within(row).findByLabelText('Capacity (seats)');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(row).toHaveTextContent('Enter a whole number of seats');
  });

  it('shows a refusal and a failure each in its own notice', async () => {
    const user = userEvent.setup();
    render(<HostSessions view={week} actions={actions} />);
    const row = rowFor('Sunset kayak', '4:00 PM EST');

    reply.mockResolvedValueOnce({
      status: 'problem',
      message: 'Two guests booked seats here already.',
    });
    await user.click(
      within(row).getByRole('button', { name: 'Save capacity' }),
    );
    expect(
      await within(row).findByText(/Two guests booked seats/),
    ).toBeInTheDocument();

    reply.mockResolvedValueOnce({ status: 'failed' });
    await user.click(within(row).getByRole('button', { name: 'Save price' }));
    expect(
      await within(row).findByText(/nothing was saved/),
    ).toBeInTheDocument();
  });

  it('publishes the week it shows', async () => {
    const user = userEvent.setup();
    render(<HostSessions view={week} actions={actions} />);
    await user.click(screen.getByRole('button', { name: 'Publish this week' }));
    expect(reply.mock.calls[0]?.[1].get('weekStart')).toBe('2026-11-09');
  });

  it('says so for a week with no sessions and no experiences, and draws no one-off form', () => {
    render(<HostSessions view={emptyWeek} actions={actions} />);
    expect(screen.getByText('No sessions this week.')).toBeInTheDocument();
    expect(
      screen.getByText('You have no experiences yet.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add session' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'This week' })).toHaveAttribute(
      'href',
      '/host/sessions',
    );
  });

  it('adds a one-off session from the experiences the host has', async () => {
    const user = userEvent.setup();
    render(<HostSessions view={week} actions={actions} />);
    await user.selectOptions(
      screen.getByLabelText('Experience'),
      'Harbor tour',
    );
    await user.click(screen.getByRole('button', { name: 'Add session' }));
    expect(reply.mock.calls[0]?.[1].get('experienceId')).toBe(
      '00000000-0000-4000-8000-0000000000a2',
    );
  });
});
