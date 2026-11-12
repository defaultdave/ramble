import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  blankValues,
  choices,
  listRows,
  nextCursorId,
  savedPhotos,
  savedValues,
  savedView,
} from './ExperienceEditor.fixtures';
import { ExperienceEditView } from './ExperienceEditView';
import { ExperienceForm } from './ExperienceForm';
import { ExperiencesList } from './ExperiencesList';

// Behaviours under test:
// - the create form asks for a host, starts on the default tier with no category, and posts no experience id
// - the edit form is prefilled from the saved experience, carries its id, and has no host field
// - prices show as typed ("85.00"), and the checkboxes reflect the saved flags
// - a field the last try refused shows its problem text and is marked invalid, a ticked-box problem as an alert
// - a guide-only entry's link is required; any other status leaves it optional
// - the cancellation tier choices carry their refund terms
// - the edit view shows the status in words and the host, and its form saves through the action it is given
// - the edit view shows the photos and the form that adds one
// - the list links each experience, shows host, category and status in words, filters by address and pages by link
// - a list with no rows says so

const noop = () => undefined;

describe('ExperienceForm, creating', () => {
  it('asks for a host and starts on the default tier with nothing else chosen', () => {
    const { container } = render(
      <ExperienceForm action={noop} values={blankValues} choices={choices} />,
    );

    expect(screen.getByLabelText('Host')).toBeRequired();
    expect(screen.getByLabelText('Host')).toHaveValue('');
    expect(screen.getByLabelText('Category')).toHaveValue('');
    expect(screen.getByLabelText(/Cancellation tier/)).toHaveDisplayValue(
      'Flexible: Free cancellation up to 24 hours before',
    );
    expect(screen.getByLabelText(/Address name/)).not.toBeRequired();
    expect(
      screen.getByRole('button', { name: 'Create draft experience' }),
    ).toBeInTheDocument();
    expect(container.querySelector('input[name="experienceId"]')).toBeNull();
  });
});

describe('ExperienceForm, editing', () => {
  const renderEdit = (
    props: Partial<Parameters<typeof ExperienceForm>[0]> = {},
  ) =>
    render(
      <ExperienceForm
        action={noop}
        values={savedValues}
        choices={choices}
        experienceId={savedView.id}
        {...props}
      />,
    );

  it('is prefilled from the saved experience and carries its id', () => {
    const { container } = renderEdit();

    expect(screen.getByLabelText('Name')).toHaveValue('Wheel throwing night');
    expect(screen.getByLabelText(/Address name/)).toBeRequired();
    expect(screen.getByLabelText(/Address name/)).toHaveValue(
      'wheel-throwing-night',
    );
    expect(screen.getByLabelText(/Duration/)).toHaveValue('150');
    expect(screen.getByLabelText('Category')).toHaveDisplayValue('Classes');
    expect(screen.getByLabelText('Age rule')).toHaveDisplayValue('Age range');
    expect(screen.getByLabelText(/Minimum age/)).toHaveValue('8');
    expect(screen.getByLabelText(/Maximum age/)).toHaveValue('14');
    expect(screen.getByLabelText(/Weather policy/)).toHaveDisplayValue(
      'Decided before the start',
    );
    expect(screen.getByLabelText(/^Waiver/)).toHaveDisplayValue(
      'Clay Corner waiver (version 2)',
    );
    expect(container.querySelector('input[name="experienceId"]')).toHaveValue(
      savedView.id,
    );
    expect(screen.queryByLabelText('Host')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save experience' }),
    ).toBeInTheDocument();
  });

  it('shows the prices as typed and the flags as saved', () => {
    renderEdit();

    expect(screen.getByLabelText(/Adult price/)).toHaveValue('85');
    expect(screen.getByLabelText(/Child price/)).toHaveValue('40.50');
    expect(
      screen.getByRole('checkbox', { name: /child takes a space/ }),
    ).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /outdoors/ })).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /accept a waiver/ }),
    ).toBeChecked();
  });

  it('marks a refused field invalid with its problem text', () => {
    renderEdit({ problems: ['adultPrice', 'name'] });

    expect(screen.getByLabelText('Name')).toBeInvalid();
    expect(screen.getByLabelText(/Adult price/)).toBeInvalid();
    expect(
      screen.getByText(/Enter a price such as 85 or 12.50/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Child price/)).toBeValid();
  });

  it('shows a refused checkbox as an alert', () => {
    renderEdit({ problems: ['outdoor'] });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'An outdoor experience states a weather policy.',
    );
  });

  it.each([
    [true, true],
    [false, false],
  ])(
    'requires the link-out address when guide only is %s: %s',
    (guideOnly, required) => {
      renderEdit({ guideOnly });

      const link = screen.getByLabelText(/Link-out address/);
      if (required) expect(link).toBeRequired();
      else expect(link).not.toBeRequired();
    },
  );

  it('offers the shared tiers with their refund terms', () => {
    renderEdit();

    const tiers = within(screen.getByLabelText(/Cancellation tier/));
    expect(
      tiers.getByRole('option', {
        name: 'Strict: Free cancellation up to 7 days before',
      }),
    ).toBeInTheDocument();
  });
});

describe('ExperienceEditView', () => {
  it('shows the status in words and the host, above the form', () => {
    render(
      <ExperienceEditView
        view={savedView}
        choices={choices}
        save={noop}
        addPhoto={noop}
      />,
    );

    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Host: Clay Corner')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Wheel throwing night');
  });

  it('shows the photos with the form that adds one', () => {
    render(
      <ExperienceEditView
        view={{ ...savedView, photos: savedPhotos }}
        choices={choices}
        save={noop}
        addPhoto={noop}
      />,
    );

    const photos = within(screen.getByRole('region', { name: 'Photos' }));
    expect(photos.getAllByRole('listitem')).toHaveLength(savedPhotos.length);
    expect(photos.getByRole('button', { name: 'Add photo' })).toBeVisible();
  });

  it('requires the link for a guide-only entry', () => {
    render(
      <ExperienceEditView
        view={{ ...savedView, status: 'guide_only' }}
        choices={choices}
        save={noop}
        addPhoto={noop}
      />,
    );

    expect(screen.getByText('Guide only')).toBeInTheDocument();
    expect(screen.getByLabelText(/Link-out address/)).toBeRequired();
  });
});

describe('ExperiencesList', () => {
  const renderList = (
    props: Partial<Parameters<typeof ExperiencesList>[0]> = {},
  ) =>
    render(
      <ExperiencesList
        rows={listRows}
        query={{}}
        filters={{ status: null, hostId: null, categoryId: null }}
        hosts={choices.hosts}
        categories={choices.categories}
        cursor={null}
        nextCursor={null}
        {...props}
      />,
    );

  it('links each experience and shows host, category and status in words', () => {
    renderList();

    const table = screen.getByRole('table', { name: 'Experiences' });
    expect(
      within(table).getByRole('link', { name: 'Harbour bike ride' }),
    ).toHaveAttribute('href', `/ops/experiences/${listRows[1]?.id ?? ''}`);
    const row = within(table).getByRole('row', { name: /Harbour bike ride/ });
    expect(within(row).getByText('Spoke & Saddle')).toBeInTheDocument();
    expect(within(row).getByText('Tours')).toBeInTheDocument();
    expect(within(row).getByText('Draft')).toBeInTheDocument();
  });

  it('filters by status through links that keep the other filters', () => {
    renderList({ query: { host: choices.hosts[0]?.value ?? '' } });

    const nav = screen.getByRole('navigation', {
      name: 'Filter experiences by status',
    });
    const live = within(nav).getByRole('link', { name: 'Live' });
    expect(live.getAttribute('href')).toContain('status=live');
    expect(live.getAttribute('href')).toContain('host=');
  });

  it('filters by host and category with a form that reads from the address, and carries the status', () => {
    const { container } = renderList({
      filters: {
        status: 'live',
        hostId: choices.hosts[1]?.value ?? null,
        categoryId: choices.categories[0]?.value ?? null,
      },
    });

    const form = container.querySelector('form');
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/ops/experiences');
    expect(screen.getByLabelText('Host')).toHaveDisplayValue('Spoke & Saddle');
    expect(screen.getByLabelText('Category')).toHaveDisplayValue('Classes');
    expect(container.querySelector('input[name="status"]')).toHaveValue('live');
    expect(
      screen.getByRole('button', { name: 'Apply filters' }),
    ).toHaveAttribute('type', 'submit');
  });

  it('carries no status when none is chosen', () => {
    const { container } = renderList();

    expect(container.querySelector('input[name="status"]')).toBeNull();
  });

  it('pages by link', () => {
    renderList({ cursor: listRows[0]?.id ?? null, nextCursor: nextCursorId });

    expect(
      screen.getByRole('link', { name: 'Next page' }).getAttribute('href'),
    ).toContain(`cursor=${nextCursorId}`);
    expect(
      screen.getByRole('link', { name: 'First page' }),
    ).toBeInTheDocument();
  });

  it('says so when nothing matches', () => {
    renderList({ rows: [] });

    expect(screen.getByText('No experiences match')).toBeInTheDocument();
  });
});
