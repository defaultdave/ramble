import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { blocks } from '@/lib/seed/richText';
import { HelpArticleView } from './HelpArticleView';
import { HelpIndex } from './HelpIndex';

// Behaviours under test:
// - the index has one h1, a search that is a GET form to /help with a labeled, length-capped field, and a way to contact us
// - with no search it lists every article as a link to its page, with its summary when it has one
// - a search shows its count, the term in the field, and a way back to every article
// - no results says so, names the term, and offers every article instead of an empty list
// - an article shows its title, summary, body, a way back, and a way to contact us

const articles = [
  {
    id: '1',
    slug: 'how-to-cancel',
    title: 'How do I cancel?',
    summary: 'Use the link.',
  },
  { id: '2', slug: 'where-to-meet', title: 'Where do I meet?', summary: null },
];

describe('HelpIndex', () => {
  it('has one h1 and a labeled search that submits a GET to the help center', () => {
    render(<HelpIndex view={{ kind: 'articles', articles }} />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const form = screen.getByRole('search');
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/help');
    const field = within(form).getByLabelText('Search help articles');
    expect(field).toHaveAttribute('name', 'q');
    expect(field).toHaveAttribute('maxlength', '80');
    expect(within(form).getByRole('button', { name: 'Search' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute(
      'href',
      '/contact',
    );
  });

  it('lists every article as a link, with a summary when there is one', () => {
    render(<HelpIndex view={{ kind: 'articles', articles }} />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'All help articles' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'How do I cancel?' }),
    ).toHaveAttribute('href', '/help/how-to-cancel');
    expect(screen.getByText('Use the link.')).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows the count and the term for a search, and a way back to every article', () => {
    render(
      <HelpIndex
        view={{
          kind: 'results',
          query: 'cancel',
          articles: articles.slice(0, 1),
        }}
      />,
    );

    expect(screen.getByLabelText('Search help articles')).toHaveValue('cancel');
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: '1 article matches “cancel”',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'See all help articles' }),
    ).toHaveAttribute('href', '/help');
  });

  it('says no article matches, and offers every article instead of an empty list', () => {
    render(<HelpIndex view={{ kind: 'none', query: '100%' }} />);

    expect(
      screen.getByRole('heading', { level: 2, name: /No articles match/ }),
    ).toHaveTextContent('100%');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'See all help articles' }),
    ).toHaveAttribute('href', '/help');
  });
});

describe('HelpArticleView', () => {
  it('shows the article and the ways out of it', () => {
    render(
      <HelpArticleView
        article={{
          title: 'How do I cancel?',
          summary: 'Use the link.',
          body: blocks('Open your email.', { heading: 'What you get back' }),
        }}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'How do I cancel?' }),
    ).toBeVisible();
    expect(screen.getByText('Use the link.')).toBeVisible();
    expect(screen.getByText('Open your email.')).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 2, name: 'What you get back' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'All help articles' }),
    ).toHaveAttribute('href', '/help');
    expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute(
      'href',
      '/contact',
    );
  });

  it('leaves out the summary when there is none', () => {
    const { container } = render(
      <HelpArticleView
        article={{ title: 'T', summary: null, body: blocks('Body.') }}
      />,
    );

    expect(container.querySelector('header p')).toBeNull();
    expect(screen.getByText('Body.')).toBeVisible();
  });
});
