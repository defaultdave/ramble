import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listFiles, root, src } from '../../tests/support/importGraph';

// Behaviours under test: the server files that guard on the host owner role are a fixed list, so a
// new file that does fails this test and its author must add it here. This only pins the list; the
// authorization matrix's own coverage check (tests/db/authz-matrix.db.test.ts) is what holds each
// Caller-taking function in those files to a row.

const server = path.join(src, 'server');

const guardsOnHostOwner = listFiles(server)
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
  .filter((file) =>
    /\bRole\.HostOwner\b|\brequireHostOwnerId\b/.test(
      readFileSync(file, 'utf8'),
    ),
  )
  .map((file) => path.relative(root, file))
  .sort();

describe('the modules that guard on the host owner role', () => {
  it('are the ones the authorization matrix covers', () => {
    expect(guardsOnHostOwner).toEqual([
      'src/server/auth/caller.ts',
      'src/server/db/cancelSession.ts',
      'src/server/db/catalog.ts',
      'src/server/db/hostFields.ts',
      'src/server/db/hostGuestLists.ts',
      'src/server/db/hostSettings.ts',
      'src/server/db/ledger.ts',
      'src/server/db/photos.ts',
      'src/server/db/sessions.ts',
      'src/server/db/staffRoles.ts',
      'src/server/hostStaffInvite.ts',
    ]);
  });
});
