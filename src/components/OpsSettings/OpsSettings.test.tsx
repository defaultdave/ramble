import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { settingsBounds } from '@/lib/settings';
import { OpsSettings, type OpsSettingsProps } from './OpsSettings';

// Behaviours under test, one per decision, branch or risk:
// - the form is prefilled with the stored values and posts to the action
// - it posts the six settings and no gift setting
// - every control has a visible label, and the numbers carry their limits as hints
// - a refused field shows its problem text and is marked invalid; the others stay valid
// - paused experiences list as links to their ops pages with their host; none says so
// - the full-list link shows only when the summary has one
// - the tiers list their name and terms and mark the default; they have no control to edit them

const noop = () => undefined;
const props: OpsSettingsProps = {
  values: {
    bannerText: 'Closed Monday',
    bookingsPaused: true,
    holdMinutes: '10',
    paymentGraceMinutes: '5',
    checkoutMaintenance: false,
    taxRatePercent: '8.875',
  },
  action: noop,
  problems: [],
  paused: {
    rows: [
      {
        id: 'e1',
        name: 'Sunrise Kayak',
        hostName: 'Spoke',
        href: '/ops/experiences/e1',
      },
    ],
    moreHref: null,
  },
  tiers: [
    {
      id: 't1',
      name: 'Flexible',
      terms: 'Free cancellation up to 24 hours before',
      isDefault: true,
    },
    {
      id: 't2',
      name: 'Strict',
      terms: 'Free cancellation up to 7 days before',
      isDefault: false,
    },
  ],
};

describe('OpsSettings', () => {
  it('is prefilled with the stored settings', () => {
    render(<OpsSettings {...props} />);
    expect(screen.getByLabelText(/Banner text/)).toHaveValue('Closed Monday');
    expect(
      screen.getByLabelText('Pause bookings on every experience'),
    ).toBeChecked();
    expect(
      screen.getByLabelText('Mark checkout as under maintenance'),
    ).not.toBeChecked();
    expect(screen.getByLabelText(/Hold length/)).toHaveValue('10');
    expect(screen.getByLabelText(/Payment grace/)).toHaveValue('5');
    expect(screen.getByLabelText(/Tax rate/)).toHaveValue('8.875');
  });

  it('posts the six settings and no gift setting', () => {
    const { container } = render(<OpsSettings {...props} />);
    const names = [
      ...container.querySelectorAll<HTMLInputElement>('form [name]'),
    ].map((field) => field.name);
    expect(names).toEqual([
      'bannerText',
      'bookingsPaused',
      'checkoutMaintenance',
      'holdMinutes',
      'paymentGraceMinutes',
      'taxRatePercent',
    ]);
  });

  it('carries the limits on the banner and in the hints', () => {
    render(<OpsSettings {...props} />);
    expect(screen.getByLabelText(/Banner text/)).toHaveAttribute(
      'maxlength',
      String(settingsBounds.bannerChars),
    );
    expect(screen.getByLabelText(/Hold length/)).toHaveAccessibleDescription(
      /1 to 60/,
    );
    expect(screen.getByLabelText(/Payment grace/)).toHaveAccessibleDescription(
      /0 to 30/,
    );
  });

  it('marks a refused field with its problem and leaves the others valid', () => {
    render(<OpsSettings {...props} problems={['taxRatePercent']} />);
    const tax = screen.getByLabelText(/Tax rate/);
    expect(tax).toBeInvalid();
    expect(tax).toHaveAccessibleDescription(/like 8.875/);
    expect(screen.getByLabelText(/Hold length/)).toBeValid();
  });

  it('links each paused experience to its ops page', () => {
    render(<OpsSettings {...props} />);
    expect(screen.getByRole('link', { name: /Sunrise Kayak/ })).toHaveAttribute(
      'href',
      '/ops/experiences/e1',
    );
    expect(
      screen.queryByRole('link', { name: 'See every paused experience' }),
    ).toBeNull();
  });

  it('says so when nothing is paused, and links the full list when there is more', () => {
    const { rerender } = render(
      <OpsSettings {...props} paused={{ rows: [], moreHref: null }} />,
    );
    expect(screen.getByText('No experience is paused.')).toBeVisible();
    rerender(
      <OpsSettings
        {...props}
        paused={{
          rows: props.paused.rows,
          moreHref: '/ops/experiences?status=paused',
        }}
      />,
    );
    expect(
      screen.getByRole('link', { name: 'See every paused experience' }),
    ).toHaveAttribute('href', '/ops/experiences?status=paused');
  });

  it('lists the tiers read-only, with the default marked', () => {
    render(<OpsSettings {...props} />);
    const section = screen.getByRole('region', { name: 'Cancellation tiers' });
    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Flexible');
    expect(items[0]).toHaveTextContent(
      'Free cancellation up to 24 hours before (default)',
    );
    expect(items[1]).not.toHaveTextContent('(default)');
    expect(within(section).queryByRole('textbox')).toBeNull();
    expect(within(section).queryByRole('button')).toBeNull();
  });
});
