import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listFiles, root, src } from '../../../tests/support/importGraph';

// Behaviours under test: the functions that write ops, admin and host role grants without a
// Caller have a fixed set of users, so a third caller cannot appear without this test failing and
// someone deciding it should.
// - `grantRoleIn` is used by the staff roles module alone
// - `grantRoleToAddress` is used by the staff roles module, the staff invite path, and the grant command
// - `grantHostStaff`, the owner-checked door for a host role, and `requireHostOwnerId` are used by the staff roles module and the host invite alone

const sources = [src, path.join(root, 'scripts')]
  .flatMap(listFiles)
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));

function usersOf(name: string): string[] {
  const word = new RegExp(`\\b${name}\\b`);
  return sources
    .filter((file) => word.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file))
    .sort();
}

describe('who can write a grant without a caller', () => {
  it('reads the source: it finds the module that defines the function', () => {
    expect(usersOf('grantRoleIn')).toContain('src/server/db/staffRoles.ts');
  });

  it('lets only the staff roles module use grantRoleIn', () => {
    expect(usersOf('grantRoleIn')).toEqual(['src/server/db/staffRoles.ts']);
  });

  it('lets only the staff roles module and the host invite use grantHostStaff and requireHostOwnerId', () => {
    const allowed = [
      'src/server/db/staffRoles.ts',
      'src/server/hostStaffInvite.ts',
    ];
    expect(usersOf('grantHostStaff')).toEqual(allowed);
    expect(usersOf('requireHostOwnerId')).toEqual(allowed);
  });

  it('lets only the staff roles module, the invite path and the grant command use grantRoleToAddress', () => {
    expect(usersOf('grantRoleToAddress')).toEqual([
      'src/server/auth/grantRoleCli.ts',
      'src/server/db/staffRoles.ts',
      'src/server/staffInvite.ts',
    ]);
  });
});
