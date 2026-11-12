import type { Caller } from '@/server/auth/caller';

// The editorial list rows of the authorization matrix: each read is for ops or admin, no host role.
// The module is passed as a getter because the matrix loads it in its beforeAll, after the rows are built.

const staff = ['ops', 'admin'] as const;

type Editorial = typeof import('@/server/db/editorial');

export function editorialListRows(editorial: () => Editorial) {
  return [
    {
      fn: 'listCollectionsForEditing',
      invoke: (c) => editorial().listCollectionsForEditing(c),
      allows: { platform: staff },
    },
    {
      fn: 'listHomeModulesForEditing',
      invoke: (c) => editorial().listHomeModulesForEditing(c),
      allows: { platform: staff },
    },
    {
      fn: 'listPageCopyForEditing',
      invoke: (c) => editorial().listPageCopyForEditing(c),
      allows: { platform: staff },
    },
    {
      fn: 'listHelpArticlesForEditing',
      invoke: (c) => editorial().listHelpArticlesForEditing(c),
      allows: { platform: staff },
    },
  ] satisfies {
    fn: string;
    invoke: (caller: Caller) => Promise<unknown>;
    allows: { platform: readonly string[] };
  }[];
}
