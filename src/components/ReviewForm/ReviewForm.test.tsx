import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewDraft } from '@/lib/reviewDraft';
import type { ReviewScreen, ReviewSummary } from '@/lib/reviews';
import { ReviewForm } from './ReviewForm';

// Behaviours under test, one per state and decision (the page is a server component and needs no script):
// - the form names the experience and day, offers ratings 1 to 5 as one required radio group, and a required body with its length limit
// - submitting posts exactly the link's reference and token with the rating and the words, once
// - a failed submit names each field to look at again, with a summary alert that links to the first of them, and none otherwise
// - the group's error hangs on the rating group and only its first radio is marked invalid; the body's error is the textarea's own
// - a draft fills the form again with the rating and the words that were typed, and no draft leaves it empty
// - success, already reviewed, expired, and invalid each say so with their own title and offer a way on
// - the invalid state names no experience, and the too-many-tries state says how long to wait and has no form
// - no state but the form has a form, and the others link to browsing and help

const reference = 'RMB-7K3M9Q';
const token = 'A'.repeat(43);
const summary: ReviewSummary = {
  experienceName: 'Sunset kayak on the Hudson',
  hostName: 'Hudson Paddle Club',
  dayLabel: 'Sunday, November 15, 2026',
};

let action: ReturnType<typeof vi.fn<(formData: FormData) => Promise<void>>>;

beforeEach(() => {
  action = vi.fn(() => Promise.resolve());
});

function renderScreen(
  screen: ReviewScreen,
  withSummary = true,
  draft: ReviewDraft | null = null,
) {
  return render(
    <ReviewForm
      screen={screen}
      summary={withSummary ? summary : null}
      draft={draft}
      reference={reference}
      token={token}
      action={action}
    />,
  );
}

describe('the review form', () => {
  it('names the session and offers five ratings as one required group with a required body', () => {
    renderScreen({ kind: 'form', problems: [] });
    expect(
      screen.getByRole('heading', { level: 1, name: summary.experienceName }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('With Hudson Paddle Club · Sunday, November 15, 2026'),
    ).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Your rating' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    for (const radio of radios) expect(radio).toBeRequired();
    const body = screen.getByLabelText('Your review');
    expect(body).toBeRequired();
    expect(body).toHaveAttribute('maxlength', '2000');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('posts the link, the rating and the words once', () => {
    const { container } = renderScreen({ kind: 'form', problems: [] });
    fireEvent.click(screen.getByLabelText(/^4/));
    fireEvent.change(screen.getByLabelText('Your review'), {
      target: { value: 'A lovely evening.' },
    });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(action).toHaveBeenCalledTimes(1);
    const data = action.mock.calls[0]?.[0];
    expect(Object.fromEntries(data?.entries() ?? [])).toEqual({
      reference,
      token,
      rating: '4',
      body: 'A lovely evening.',
    });
  });

  it.each([
    ['rating', 'Choose a rating from 1 to 5.'],
    ['body', 'Write a few words about it.'],
  ] as const)('names the %s field to look at again', (field, message) => {
    renderScreen({ kind: 'form', problems: [field] });
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(
      screen.getByText('Some details need another look.'),
    ).toBeInTheDocument();
  });

  it('names both fields when both failed', () => {
    renderScreen({ kind: 'form', problems: ['rating', 'body'] });
    expect(
      screen.getByText('Choose a rating from 1 to 5.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Write a few words about it.')).toBeInTheDocument();
  });
});

describe('a failed submit', () => {
  it('links the summary to the first field to look at again', () => {
    renderScreen({ kind: 'form', problems: ['body', 'rating'] });
    const jump = screen.getByRole('link', { name: 'Go to your rating' });
    const target = jump.getAttribute('href')?.slice(1) ?? '';
    expect(document.getElementById(target)).toBe(
      screen.getByRole('radio', { name: /^1/ }),
    );
  });

  it('links the summary to the body when it is the only problem', () => {
    renderScreen({ kind: 'form', problems: ['body'] });
    const jump = screen.getByRole('link', { name: 'Go to your review' });
    const target = jump.getAttribute('href')?.slice(1) ?? '';
    expect(document.getElementById(target)).toBe(
      screen.getByLabelText('Your review'),
    );
  });

  it('describes the rating group by its error and marks only the first radio invalid', () => {
    renderScreen({ kind: 'form', problems: ['rating'] });
    const group = screen.getByRole('group', { name: 'Your rating' });
    expect(group).toHaveAccessibleDescription('Choose a rating from 1 to 5.');
    const invalid = within(group)
      .getAllByRole('radio')
      .map((radio) => radio.getAttribute('aria-invalid'));
    expect(invalid).toEqual(['true', null, null, null, null]);
  });

  it('marks nothing invalid, and links nowhere, when nothing failed', () => {
    const { container } = renderScreen({ kind: 'form', problems: [] });
    expect(container.querySelector('[aria-invalid]')).toBeNull();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Your rating' }),
    ).not.toHaveAttribute('aria-describedby');
  });

  it('shows the rating and the words that were typed, so a failed submit does not clear them', () => {
    renderScreen({ kind: 'form', problems: ['body'] }, true, {
      reference,
      rating: 4,
      body: 'A lovely evening.',
    });
    expect(screen.getByRole('radio', { name: /^4/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^3/ })).not.toBeChecked();
    expect(screen.getByLabelText('Your review')).toHaveValue(
      'A lovely evening.',
    );
  });

  it('keeps the words when no rating was chosen', () => {
    renderScreen({ kind: 'form', problems: ['rating'] }, true, {
      reference,
      rating: null,
      body: 'A lovely evening.',
    });
    expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0);
    expect(screen.getByLabelText('Your review')).toHaveValue(
      'A lovely evening.',
    );
  });

  it('starts empty with no draft', () => {
    renderScreen({ kind: 'form', problems: [] });
    expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0);
    expect(screen.getByLabelText('Your review')).toHaveValue('');
  });
});

describe('the other states', () => {
  it.each([
    ['success', 'Thank you for your review'],
    ['already_reviewed', 'You have already reviewed this booking'],
    ['expired', 'This review window has closed'],
  ] as const)(
    '%s says so, names the session, and offers a way on',
    (kind, title) => {
      const { container } = renderScreen({ kind });
      expect(screen.getByText(title)).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { level: 1, name: summary.experienceName }),
      ).toBeInTheDocument();
      expect(container.querySelector('form')).toBeNull();
      expect(
        screen.getByRole('link', { name: 'Explore more experiences' }),
      ).toHaveAttribute('href', '/new-york/browse');
      expect(screen.getByRole('link', { name: 'Get help' })).toHaveAttribute(
        'href',
        '/help',
      );
    },
  );

  it('says only that the link does not work when it is invalid, and names no session', () => {
    const { container } = renderScreen({ kind: 'invalid' }, false);
    expect(
      screen.getByText("This review link doesn't work"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'How was it?' }),
    ).toBeInTheDocument();
    expect(container.querySelector('form')).toBeNull();
    expect(container).not.toHaveTextContent('Sunset kayak');
  });

  it('says how long to wait when the link has been tried too often, with no form', () => {
    const { container } = renderScreen(
      { kind: 'too_many_tries', retryAfterSeconds: 42 },
      false,
    );
    expect(screen.getByText('Too many tries')).toBeInTheDocument();
    expect(container).toHaveTextContent('Try again in 42 seconds.');
    expect(container.querySelector('form')).toBeNull();
  });
});
