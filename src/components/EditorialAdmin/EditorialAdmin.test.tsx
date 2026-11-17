import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EntriesList } from './EntriesList';
import { EntryForm } from './EntryForm';
import {
  draftArticle,
  publishedArticle,
  rows,
} from './EditorialAdmin.fixtures';

// Behaviours under test:
// - the list shows each article with its address and status in words, linked to its editor
// - an empty list says so and still offers a new article, and a failed read offers a retry
// - a new article form saves a draft or publishes it, and carries no id
// - a published article's form saves changes or unpublishes it, and carries its id and status
// - a refused field shows its sentence

const noop = () => undefined;

describe('EntriesList', () => {
  it('links each article to its editor with its address and status', () => {
    render(<EntriesList rows={rows} query={{}} />);
    const row = screen.getByRole('row', { name: /How to cancel/ });
    expect(
      within(row).getByRole('link', { name: 'How to cancel' }),
    ).toHaveAttribute('href', `/ops/editorial/${rows[0]?.id ?? ''}`);
    expect(within(row).getByText('how-to-cancel')).toBeInTheDocument();
    expect(within(row).getByText('Published')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New article' })).toHaveAttribute(
      'href',
      '/ops/editorial/new',
    );
  });

  it('says when there are no articles', () => {
    render(<EntriesList rows={[]} query={{}} />);
    expect(screen.getByText('No articles yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New article' })).toBeVisible();
  });

  it('offers a retry when the read failed', () => {
    render(<EntriesList rows={[]} query={{}} failed />);
    expect(
      screen.getByText('The articles could not be loaded.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/ops/editorial',
    );
  });
});

describe('EntryForm', () => {
  it('offers save draft and publish for a new article, with no id', async () => {
    const { container } = render(
      <EntryForm entry={null} problems={[]} save={noop} />,
    );
    await screen.findByRole('textbox', { name: 'Body' });
    expect(screen.getByRole('button', { name: 'Save draft' })).toHaveValue(
      'save',
    );
    expect(screen.getByRole('button', { name: 'Publish' })).toHaveValue(
      'publish',
    );
    expect(container.querySelector('input[name="id"]')).toBeNull();
  });

  it('offers save changes and unpublish for a published article, carrying its id and status', async () => {
    const { container } = render(
      <EntryForm entry={publishedArticle} problems={[]} save={noop} />,
    );
    await screen.findByRole('textbox', { name: 'Body' });
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
      'How to cancel',
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Unpublish' })).toHaveValue(
      'unpublish',
    );
    expect(container.querySelector('input[name="id"]')).toHaveValue(
      publishedArticle.id,
    );
    expect(container.querySelector('input[name="status"]')).toHaveValue(
      'published',
    );
  });

  it('shows the sentence for each refused field', async () => {
    render(
      <EntryForm
        entry={draftArticle}
        problems={['title', 'slug']}
        save={noop}
      />,
    );
    await screen.findByRole('textbox', { name: 'Body' });
    expect(screen.getByText(/Add a title of up to/)).toBeVisible();
    expect(screen.getByText(/lower-case words/)).toBeVisible();
  });
});
