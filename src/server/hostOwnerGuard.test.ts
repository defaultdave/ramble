import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listFiles, root, src } from '../../tests/support/importGraph';

// Behaviours under test: a server module that guards on the host owner role has a fixed set of
// files, so a new host write function in a file nobody listed here fails this test, and whoever
// adds the file also adds its rows to the authorization matrix (tests/db/authz-matrix.db.test.ts),
// whose coverage check then holds every function in it to a row.

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
      'src/server/db/hostGuestLists.ts',
      'src/server/db/ledger.ts',
      'src/server/db/photos.ts',
      'src/server/db/sessions.ts',
      'src/server/db/staffRoles.ts',
      'src/server/hostStaffInvite.ts',
    ]);
  });
});
