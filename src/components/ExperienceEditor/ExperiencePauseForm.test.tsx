import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { experienceStatuses } from '@/lib/catalog';
import { ExperiencePauseForm } from './ExperiencePauseForm';

// Behaviours under test:
// - a live or guide-only experience offers Pause, with the experience id in the form, and no Unpause
// - a paused experience offers Unpause, with the experience id in the form, and no Pause
// - any other status offers neither, because neither action accepts it

const noop = () => undefined;
const experienceId = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';

function renderFor(status: (typeof experienceStatuses)[number]) {
  return render(
    <ExperiencePauseForm
      experienceId={experienceId}
      status={status}
      pause={noop}
      unpause={noop}
    />,
  );
}

describe('ExperiencePauseForm', () => {
  it.each([
    ['live', 'Pause experience', 'Unpause experience'],
    ['guide_only', 'Pause experience', 'Unpause experience'],
    ['paused', 'Unpause experience', 'Pause experience'],
  ] as const)(
    "offers only %s's action, carrying the id",
    (status, offered, withheld) => {
      const { container } = renderFor(status);

      expect(screen.getByRole('button', { name: offered })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: withheld }),
      ).not.toBeInTheDocument();
      expect(container.querySelector('input[name="experienceId"]')).toHaveValue(
        experienceId,
      );
    },
  );

  it.each(
    experienceStatuses.filter(
      (s) => s !== 'live' && s !== 'guide_only' && s !== 'paused',
    ),
  )('offers nothing for %s', (status) => {
    const { container } = renderFor(status);

    expect(container).toBeEmptyDOMElement();
  });
});
