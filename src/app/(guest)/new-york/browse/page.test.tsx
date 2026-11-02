import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { browseResultsId } from '@/lib/pages/browse';
import BrowsePage from './page';

// Behaviours under test, one per decision, branch or risk:
// - a skip link to the streamed results sits inside <noscript>, so only a browser with scripting off shows it, and it points at the id the results carry

vi.mock('@/server/browse', () => ({ getBrowseTitle: vi.fn() }));
vi.mock('./BrowseContent', () => ({ BrowseContent: () => null }));

describe('BrowsePage', () => {
  it('offers a skip link to the results for a browser with scripting off', () => {
    const markup = renderToStaticMarkup(
      <BrowsePage
        params={Promise.resolve({})}
        searchParams={Promise.resolve({})}
      />,
    );
    const inner = /<noscript>(.*)<\/noscript>/s.exec(markup)?.[1];
    document.body.innerHTML = inner ?? '';

    expect(
      screen.getByRole('link', { name: 'Skip to results' }),
    ).toHaveAttribute('href', `#${browseResultsId}`);
  });
});
