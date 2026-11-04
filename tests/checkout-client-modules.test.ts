import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  hasClientDirective,
  importClosure,
  importsOf,
  listFiles,
  src,
} from './support/importGraph';

// An error or client module in the checkout group is loaded by the browser. The guest frame's navigation
// reaches the catalog schemas (zod), whose `Function("")` probe trips the nonce policy, so no client
// module there may reach `GuestShell` or `siteNav`, directly or through another import. A frame belongs in
// a server layout beside the error file instead.

const checkoutGroup = path.join(src, 'app', '(checkout)');
const forbidden = [
  path.join(src, 'components', 'GuestShell', 'GuestShell.tsx'),
  path.join(src, 'lib', 'pages', 'siteNav.ts'),
];

const clientModules = listFiles(checkoutGroup).filter(
  (file) =>
    /\.tsx?$/.test(file) &&
    !/\.(test|stories)\.tsx?$/.test(file) &&
    hasClientDirective(readFileSync(file, 'utf8')),
);

describe("the checkout group's client modules", () => {
  it('include its three error boundaries', () => {
    expect(
      clientModules.map((file) => path.relative(checkoutGroup, file)).sort(),
    ).toEqual([
      path.join('(site)', 'error.tsx'),
      path.join('checkout', 'error.tsx'),
      'error.tsx',
    ]);
  });

  it.each(
    clientModules.map((file) => [path.relative(checkoutGroup, file), file]),
  )('reach neither GuestShell nor siteNav: %s', (_name, file) => {
    const { files } = importClosure([file]);

    expect(files.filter((reached) => forbidden.includes(reached))).toEqual([]);
  });

  it('would be caught if one did, since the walk reaches both through the not-found frame', () => {
    const { files } = importClosure([
      path.join(checkoutGroup, 'not-found.tsx'),
    ]);

    expect(forbidden.filter((file) => !files.includes(file))).toEqual([]);
  });
});

describe('the import walk', () => {
  it.each([
    ["import { a } from './a';", ['./a']],
    ["import './side';", ['./side']],
    ["export { b } from './b';", ['./b']],
    ["import type { T } from './types';", []],
    ["import type {\n  T,\n  U,\n} from './types';", []],
    ["export type { T } from './types';", []],
    ["import { type T, a } from './mixed';", ['./mixed']],
    ["const lazy = import('./lazy');", ['./lazy']],
  ])('reads %j as loading %j', (text, expected) => {
    expect(importsOf(text, 'module.ts')).toEqual(expected);
  });
});
