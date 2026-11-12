import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hostLimits } from '@/lib/hostSetup';
import { HostSettings, type HostSettingsProps } from './HostSettings';

// Behaviours under test, one per decision, branch or risk:
// - the form is prefilled with the host's name, about text and notice address, and posts to the action
// - it asks for nothing else: no address name, time zone or host id is posted
// - the name is required and the fields carry the ops form's limits
// - a blank about text and notice address show empty
// - a field the last try refused shows its problem text and is marked invalid
// - the notice of the last save is shown, and none is shown when there is none

const noop = () => undefined;
const props: HostSettingsProps = {
  values: {
    name: 'Spoke & Saddle',
    description: 'Two cycling teachers.',
    notificationEmail: 'bookings@example.com',
  },
  action: noop,
  notice: null,
  problems: [],
};

describe('HostSettings', () => {
  it('is prefilled with the host settings', () => {
    render(<HostSettings {...props} />);
    expect(screen.getByLabelText(/Host name/)).toHaveValue('Spoke & Saddle');
    expect(screen.getByLabelText(/About/)).toHaveValue('Two cycling teachers.');
    expect(screen.getByLabelText(/Booking notice address/)).toHaveValue(
      'bookings@example.com',
    );
    expect(
      screen.getByRole('button', { name: 'Save settings' }),
    ).toBeInTheDocument();
  });

  it('posts only the three settings', () => {
    const { container } = render(<HostSettings {...props} />);
    const names = [
      ...container.querySelectorAll<HTMLInputElement>('form [name]'),
    ].map((field) => field.name);
    expect(names).toEqual(['name', 'description', 'notificationEmail']);
  });

  it('requires a name and carries the host limits', () => {
    render(<HostSettings {...props} />);
    expect(screen.getByLabelText(/Host name/)).toBeRequired();
    expect(screen.getByLabelText(/Host name/)).toHaveAttribute(
      'maxlength',
      String(hostLimits.name),
    );
    expect(screen.getByLabelText(/About/)).toHaveAttribute(
      'maxlength',
      String(hostLimits.description),
    );
  });

  it('shows blank optional settings empty', () => {
    render(
      <HostSettings
        {...props}
        values={{ name: 'Quill', description: null, notificationEmail: null }}
      />,
    );
    expect(screen.getByLabelText(/About/)).toHaveValue('');
    expect(screen.getByLabelText(/Booking notice address/)).toHaveValue('');
  });

  it('marks a refused field with its problem text', () => {
    render(<HostSettings {...props} problems={['notificationEmail']} />);
    expect(screen.getByLabelText(/Booking notice address/)).toBeInvalid();
    expect(
      screen.getByText('Enter an email address, like bookings@example.com.'),
    ).toBeVisible();
    expect(screen.getByLabelText(/Host name/)).toBeValid();
  });

  it('shows the notice of the last save', () => {
    const { rerender } = render(<HostSettings {...props} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(
      <HostSettings
        {...props}
        notice={{ tone: 'success', title: 'Host saved.' }}
      />,
    );
    expect(screen.getByText('Host saved.')).toBeVisible();
  });
});
