import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  opsCallerOrLeave: vi.fn(),
  saveHelpArticle: vi.fn(),
}));

class Redirected extends Error {
  constructor(readonly href: string) {
    super(href);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Redirected(href);
  },
}));
vi.mock('@/server/opsAccess', () => ({
  opsCallerOrLeave: mocks.opsCallerOrLeave,
}));
vi.mock('@/server/db/editorial', () => ({
  saveHelpArticle: mocks.saveHelpArticle,
}));

import { saveEntryAction } from './editorial';

// Behaviours under test:
// - the caller is checked first: a caller sent away saves nothing
// - a refused form returns to the form it came from, with the fields to look at, and saves nothing
// - a new entry is saved as a draft, an existing one keeps its id, and publish and unpublish move the status
// - each outcome redirects: the edit page with what the click did, the form on a taken address, the list for a missing entry

const id = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const ops = { userId: 'u', roles: ['ops'], hostIds: [] };
const body = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const fields = { intent: 'save', title: 'How to cancel', body };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.opsCallerOrLeave.mockResolvedValue(ops);
  mocks.saveHelpArticle.mockResolvedValue({ status: 'saved', value: { id } });
});

describe('saveEntryAction', () => {
  it('leaves before reading the form when the caller is not ops', async () => {
    mocks.opsCallerOrLeave.mockRejectedValue(new Redirected('/ops/editorial'));
    await expect(saveEntryAction(form(fields))).rejects.toMatchObject({
      href: '/ops/editorial',
    });
    expect(mocks.saveHelpArticle).not.toHaveBeenCalled();
  });

  it.each([
    ['a new entry', {}, '/ops/editorial/new'],
    ['an existing one', { id }, `/ops/editorial/${id}`],
  ])(
    'returns %s to its form when the title is blank',
    async (_n, extra, href) => {
      await expect(
        saveEntryAction(form({ ...fields, ...extra, title: '', slug: 'a' })),
      ).rejects.toMatchObject({ href: `${href}?notice=invalid&fields=title` });
      expect(mocks.saveHelpArticle).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['save', 'draft', 'draft', 'saved'],
    ['publish', 'draft', 'published', 'published'],
    ['unpublish', 'published', 'draft', 'unpublished'],
  ])(
    '%s on a %s entry writes %s and shows the %s notice',
    async (intent, current, status, notice) => {
      await expect(
        saveEntryAction(form({ ...fields, id, intent, status: current })),
      ).rejects.toMatchObject({
        href: `/ops/editorial/${id}?notice=${notice}`,
      });
      expect(mocks.saveHelpArticle).toHaveBeenCalledWith(
        ops,
        expect.objectContaining({ id, status, slug: 'how-to-cancel' }),
      );
    },
  );

  it('sends a taken address back to the form with the slug marked', async () => {
    mocks.saveHelpArticle.mockResolvedValue({ status: 'slug_taken' });
    await expect(saveEntryAction(form(fields))).rejects.toMatchObject({
      href: '/ops/editorial/new?notice=slug_taken&fields=slug',
    });
  });

  it('sends a missing entry to the list', async () => {
    mocks.saveHelpArticle.mockResolvedValue({ status: 'not_found' });
    await expect(
      saveEntryAction(form({ ...fields, id })),
    ).rejects.toMatchObject({ href: '/ops/editorial' });
  });
});
