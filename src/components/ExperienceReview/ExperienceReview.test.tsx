import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  needsAltView,
  nextCursorId,
  queueRows,
  reviewView,
} from './ExperienceReview.fixtures';
import { ExperienceReviewView } from './ExperienceReviewView';
import { ReviewQueue } from './ReviewQueue';

// Behaviours under test:
// - the queue links each experience to its review page and shows host and category, with no status column
// - the queue pages by link, and an empty queue says so
// - the review page shows the host, the listing facts the host filled in, a link to the editor, and the photos
// - an experience in review offers both decisions as forms that carry its id, and the reject form asks for a reason
// - photos without alt text are named before the approval is tried, and a described gallery shows no such warning
// - an experience not in review shows where it stands and offers no decision

const noop = () => undefined;

describe('ReviewQueue', () => {
  it('links each experience to its review page and shows its host and category', () => {
    render(
      <ReviewQueue
        rows={queueRows}
        query={{}}
        cursor={null}
        nextCursor={null}
      />,
    );

    const first = queueRows[0];
    if (!first) throw new Error('expected a row');
    expect(screen.getByRole('link', { name: first.name })).toHaveAttribute(
      'href',
      `/ops/review/${first.id}`,
    );
    expect(
      screen.getByRole('columnheader', { name: 'Host' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: 'Status' }),
    ).not.toBeInTheDocument();
  });

  it('pages by link', () => {
    render(
      <ReviewQueue
        rows={queueRows}
        query={{}}
        cursor={null}
        nextCursor={nextCursorId}
      />,
    );

    expect(
      screen
        .getAllByRole('link')
        .some((link) =>
          link.getAttribute('href')?.includes(`cursor=${nextCursorId}`),
        ),
    ).toBe(true);
  });

  it('says so when nothing is waiting', () => {
    render(
      <ReviewQueue rows={[]} query={{}} cursor={null} nextCursor={null} />,
    );

    expect(
      screen.getByText('Nothing is waiting for review'),
    ).toBeInTheDocument();
  });
});

describe('ExperienceReviewView', () => {
  const renderView = (view = reviewView) =>
    render(<ExperienceReviewView view={view} approve={noop} reject={noop} />);

  it('shows the host, the listing and a link to the editor', () => {
    renderView();

    expect(screen.getByText('Host: Clay Corner')).toBeInTheDocument();
    expect(screen.getByText('Adult price: $85')).toBeInTheDocument();
    expect(
      screen.getByText('Meet at: The blue door on Spring Street'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Open in the editor' }),
    ).toHaveAttribute('href', `/ops/experiences/${reviewView.id}`);
  });

  it('offers approval and rejection as forms carrying the experience id', () => {
    const { container } = renderView();

    const forms = container.querySelectorAll('form');
    expect(forms).toHaveLength(2);
    for (const form of forms) {
      expect(form.querySelector('input[name="experienceId"]')).toHaveValue(
        reviewView.id,
      );
    }
    expect(
      screen.getByRole('button', { name: 'Approve and make live' }),
    ).toBeEnabled();
    expect(screen.getByLabelText('Reason for sending it back')).toBeRequired();
    expect(
      within(screen.getByLabelText('Reason for sending it back')).getAllByRole(
        'option',
      ),
    ).toHaveLength(5);
    expect(
      screen.getByRole('button', { name: 'Send back to draft' }),
    ).toBeInTheDocument();
  });

  it('shows the photos and no warning when each is described or decorative', () => {
    renderView();

    expect(screen.getByText('Decorative, no alt text.')).toBeInTheDocument();
    expect(screen.queryByText(/will be refused/)).not.toBeInTheDocument();
  });

  it('names the photos with no alt text before the approval is tried', () => {
    renderView(needsAltView);

    expect(
      screen.getByText(
        'Approval will be refused until these photos have alt text.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Add alt text, or mark as decorative, for photo 2.'),
    ).toBeInTheDocument();
  });

  it.each(['live', 'draft', 'paused'] as const)(
    'offers no decision for an experience that is %s',
    (status) => {
      const { container } = renderView({ ...reviewView, status });

      expect(
        screen.getByText('This experience is not waiting for review.'),
      ).toBeInTheDocument();
      expect(container.querySelector('form')).toBeNull();
    },
  );
});
