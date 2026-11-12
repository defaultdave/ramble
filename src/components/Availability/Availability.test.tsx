import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { availabilityFieldProblems } from '@/lib/availability';
import { experienceId, slots } from './Availability.fixtures';
import { AvailabilityView } from './AvailabilityView';

// Behaviours under test:
// - each slot shows its day, time, length, source and how far ahead it is open, with its seats in a labelled field
// - an experience with no slots says so, and the add form is still there
// - each seats form is a plain post carrying the experience and the slot it changes
// - the add form offers all seven days, a time, a length, seats and a source, and carries the experience
// - a refused field shows its sentence and is marked invalid; a refused day set shows its sentence
// - a field that was not refused shows no problem

const noop = () => undefined;

function renderView(
  props: Partial<Parameters<typeof AvailabilityView>[0]> = {},
) {
  return render(
    <AvailabilityView
      experienceId={experienceId}
      timeZone="America/New_York"
      slots={slots}
      addSlots={noop}
      saveSeats={noop}
      {...props}
    />,
  );
}

describe('AvailabilityView slots', () => {
  it('lists each slot with its details and seats', () => {
    renderView();

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Tuesday at 10:00, 90 minutes');
    expect(items[0]).toHaveTextContent('12 sessions open, through 2027-02-02');
    expect(items[1]).toHaveTextContent('No upcoming sessions yet');
    expect(screen.getByLabelText('Seats, Tuesday 10:00')).toHaveValue('8');
    expect(screen.getByLabelText('Seats, Saturday 14:00')).toHaveValue('4');
  });

  it('says so when there are no slots, and still offers the add form', () => {
    renderView({ slots: [] });

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByText(/no weekly slots yet/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add slots' }),
    ).toBeInTheDocument();
  });

  it('carries the experience and the slot in each seats form', () => {
    const { container } = renderView();

    const forms = container.querySelectorAll('li form');
    expect(forms).toHaveLength(2);
    expect(forms[1]?.querySelector('input[name="experienceId"]')).toHaveValue(
      experienceId,
    );
    expect(forms[1]?.querySelector('input[name="templateId"]')).toHaveValue(
      slots[1]?.id,
    );
  });
});

describe('AvailabilityView add form', () => {
  it('offers the days, time, length, seats and source', () => {
    renderView();

    expect(screen.getAllByRole('checkbox')).toHaveLength(7);
    expect(screen.getByRole('checkbox', { name: 'Monday' })).not.toBeChecked();
    expect(screen.getByLabelText('Start time')).toBeInTheDocument();
    expect(screen.getByLabelText('Length in minutes')).toBeInTheDocument();
    expect(screen.getByLabelText('Seats per session')).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Whose seats')).getAllByRole('option'),
    ).toHaveLength(3);
  });

  it('names the host’s zone beside the start time', () => {
    renderView();

    expect(
      screen.getByText(/Like 14:00, on the host’s clock in America\/New_York/),
    ).toBeInTheDocument();
  });

  it('shows a refused field’s sentence and marks it invalid', () => {
    renderView({ problems: ['startTime', 'weekdays'] });

    expect(screen.getByLabelText('Start time')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(
      screen.getByText(availabilityFieldProblems.startTime),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      availabilityFieldProblems.weekdays,
    );
  });

  it('shows no problem for a field that was not refused', () => {
    renderView({ problems: ['allocation'] });

    expect(screen.getByLabelText('Start time')).not.toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(
      screen.queryByText(availabilityFieldProblems.startTime),
    ).not.toBeInTheDocument();
  });
});
