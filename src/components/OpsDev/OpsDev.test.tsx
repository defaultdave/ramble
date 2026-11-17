import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { deadRow, doneRow, pendingRow, retryingRow } from './OpsDev.fixtures';
import { OpsDevConsole } from './OpsDevConsole';

// Behaviours under test:
// - the jobs are listed with status in words, attempts, due time and last error
// - only a waiting job has a run form, and it carries that job's id; each run button is named for its job and due time
// - the drain and the pulse are forms of their own
// - with the demo clock on, the clock can be set, moved on and reset; with it off, only reset, and the page says why
// - the clock line says whether runs use the real time or the test time
// - an empty list says so
// - with bookings that can be invited, a form lists them and posts the chosen order id; with none, it says so and offers no form
// - the reset is a form with a typed confirmation that is required, and says what goes and what stays

const noop = () => undefined;
const actions = {
  runJob: noop,
  drain: noop,
  pulse: noop,
  setClock: noop,
  reset: noop,
  sendReviewInvite: noop,
};

function renderConsole(props: {
  rows?: Parameters<typeof OpsDevConsole>[0]['rows'];
  testTimeLabel?: string | null;
  demoClockOn?: boolean;
  invitableOrders?: Parameters<typeof OpsDevConsole>[0]['invitableOrders'];
}) {
  return render(
    <OpsDevConsole
      rows={props.rows ?? [pendingRow, retryingRow, deadRow, doneRow]}
      invitableOrders={props.invitableOrders ?? []}
      query={{}}
      testTimeLabel={props.testTimeLabel ?? null}
      demoClockOn={props.demoClockOn ?? true}
      actions={actions}
    />,
  );
}

const invitable = [
  {
    value: 'a0000000-0000-4000-8000-000000000001',
    label: 'RMB-7K3M9Q · Sunset kayak · ended 2026-11-10 23:00 UTC',
  },
  {
    value: 'a0000000-0000-4000-8000-000000000002',
    label: 'RMB-2H4J6N · Wheel throwing · ended 2026-11-08 21:00 UTC',
  },
];

describe('OpsDevConsole review invites', () => {
  it('lists the invitable bookings and posts the chosen order id with a send button', () => {
    const { container } = renderConsole({ invitableOrders: invitable });
    const select = screen.getByRole('combobox', { name: 'Booking' });
    expect(within(select).getAllByRole('option')).toHaveLength(2);
    expect(container.querySelector('select[name="orderId"]')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Send invite now' }),
    ).toBeInTheDocument();
  });

  it('says so and offers no form when no booking can be invited', () => {
    renderConsole({ invitableOrders: [] });
    expect(
      screen.getByText(/No booking can be invited now/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Send invite now' }),
    ).not.toBeInTheDocument();
  });
});

describe('OpsDevConsole', () => {
  it('lists each job with its status, attempts, due time and last error', () => {
    renderConsole({});
    const table = screen.getByRole('table', { name: 'Latest jobs' });
    const dead = within(table).getAllByRole('row')[3];
    expect(dead).toHaveTextContent('guest-confirmation');
    expect(dead).toHaveTextContent('Dead');
    expect(dead).toHaveTextContent('5 of 5');
    expect(dead).toHaveTextContent('2026-11-19 08:00 UTC');
    expect(dead).toHaveTextContent('EmailRefused');
  });

  it('offers a run form only for waiting jobs, carrying the job id', () => {
    const { container } = renderConsole({});
    expect(screen.getAllByRole('button', { name: /^Run / })).toHaveLength(2);
    const ids = [
      ...container.querySelectorAll<HTMLInputElement>('input[name="jobId"]'),
    ].map((input) => input.value);
    expect(ids).toEqual([pendingRow.id, retryingRow.id]);
  });

  it('names each run button for its own job and due time, so two of one kind can be told apart', () => {
    renderConsole({});
    expect(
      screen.getByRole('button', {
        name: `Run ${pendingRow.kind}, due ${pendingRow.runAfterLabel}`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: `Run ${retryingRow.kind}, due ${retryingRow.runAfterLabel}`,
      }),
    ).toBeInTheDocument();
  });

  it('has a drain button and a pulse button', () => {
    renderConsole({});
    expect(
      screen.getByRole('button', { name: 'Drain the queue' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Trigger the pulse' }),
    ).toBeInTheDocument();
  });

  it('offers set, advance and reset when the demo clock is on', () => {
    renderConsole({ testTimeLabel: '2026-11-20 08:00 UTC' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Runs use 2026-11-20 08:00 UTC.',
    );
    expect(screen.getByLabelText('Set the time (UTC)')).toBeInTheDocument();
    expect(screen.getByLabelText('Move on by')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Back to the real time' }),
    ).toBeInTheDocument();
  });

  it('offers only reset, and says why, when the demo clock is off', () => {
    renderConsole({ demoClockOn: false });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Runs use the real time.',
    );
    expect(screen.queryByLabelText('Set the time (UTC)')).toBeNull();
    expect(screen.getByText(/demo clock is switched off/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Back to the real time' }),
    ).toBeInTheDocument();
  });

  it('has a reset form whose confirmation must be typed', () => {
    renderConsole({});
    const confirm = screen.getByLabelText('Type RESET to confirm');
    expect(confirm).toBeRequired();
    expect(confirm).toHaveAttribute('name', 'confirm');
    expect(
      screen.getByRole('button', { name: 'Reset demo data' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The catalogue, hosts, people/),
    ).toBeInTheDocument();
  });

  it('says so when there are no jobs', () => {
    renderConsole({ rows: [] });
    expect(screen.getByText('No jobs yet')).toBeInTheDocument();
  });
});
