import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { id } from '../../../../../tests/support/ids';
import { RelatedContent } from './RelatedContent';

// Behaviours under test, one per decision, branch or risk:
// - browse is read once, for the entry's category alone, as of the current minute
// - the bookable results other than the entry are drawn under "<Category> you can book"
// - a cursor miss or no other bookable experience leaves the module out
// - a failed read leaves the module out, logging only the digest and kind
// - a framework control-flow error is rethrown and not logged

const server = vi.hoisted(() => ({ browse: vi.fn(), logError: vi.fn() }));
vi.mock('@/server/browse', () => ({ getBrowseResults: server.browse }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));
vi.mock('next/server', () => ({ connection: () => Promise.resolve() }));

const item = (n: number, status: 'live' | 'guide_only' = 'live') => ({
  id: id(n),
  slug: `class-${String(n)}`,
  name: `Class ${String(n)}`,
  status,
  neighborhoodName: 'Park Slope',
  durationMinutes: 120,
  linkOutUrl: status === 'guide_only' ? 'https://host.example/' : null,
  priceOptions: [{ priceMinor: 6000, usesSpace: true }],
});
const props = {
  entryId: id(1),
  categorySlug: 'cooking',
  categoryName: 'Cooking',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  server.browse.mockResolvedValue({
    ok: true,
    items: [item(1, 'guide_only'), item(2), item(3, 'guide_only'), item(4)],
    nextCursor: null,
  });
});

describe('RelatedContent', () => {
  it('reads browse for the category alone, as of the current minute', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-20T14:03:41Z') });

    await RelatedContent(props);

    expect(server.browse).toHaveBeenCalledExactlyOnceWith(
      {
        filters: {
          categories: ['cooking'],
          neighborhoods: [],
          date: null,
          guests: null,
          price: null,
          age: null,
          setting: null,
        },
        after: null,
      },
      '2026-10-20T14:03:00.000Z',
    );
  });

  it('draws the other bookable experiences under the category', async () => {
    render(await RelatedContent(props));

    expect(
      screen.getByRole('heading', { name: 'Cooking you can book' }),
    ).toBeVisible();
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Class 2',
      'Class 4',
    ]);
  });

  it.each([
    ['a page that is not there', { ok: false, reason: 'cursor_not_found' }],
    ['a page with nothing bookable', { ok: true, items: [], nextCursor: null }],
  ])('leaves the module out for %s', async (_name, page) => {
    server.browse.mockResolvedValue(page);

    const { container } = render(await RelatedContent(props));

    expect(container).toBeEmptyDOMElement();
  });

  it('leaves the module out when the read fails, and logs only the digest and kind', async () => {
    server.browse.mockRejectedValue(
      Object.assign(new Error('secret-id'), { digest: '1234567' }),
    );

    expect(await RelatedContent(props)).toBeNull();
    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The guide entry experiences could not be read',
      { digest: '1234567', kind: 'Error' },
    );
  });
});
