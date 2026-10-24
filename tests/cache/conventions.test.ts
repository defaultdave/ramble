import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cacheProfiles } from '@/lib/cacheProfiles';
import { cacheConventionViolations } from './conventions';

const profiles = Object.keys(cacheProfiles);
const check = (source: string) =>
  cacheConventionViolations('fixture.ts', source, profiles);

const wrapperImport =
  "import { readRemoteOrFallback } from '@/server/cache/remote';\n";

describe('cacheConventionViolations', () => {
  it.each([
    [
      'a declaration with a known profile and a tag',
      `export async function getX(id: string) {
        'use cache';
        cacheLife('editorial');
        cacheTag(tags.experience(id));
        return id;
      }`,
    ],
    [
      'an arrow function in a component',
      `export const Banner = async () => {
        'use cache';
        cacheLife('settings');
        cacheTag(tags.settings);
        return null;
      };`,
    ],
    [
      'a function with no cache directive',
      `export async function getX() { return 1; }`,
    ],
    [
      'a remote function kept private and read through the wrapper',
      `${wrapperImport}
      async function spacesLeft(id: string) {
        'use cache: remote';
        cacheLife('spacesLeft');
        cacheTag(tags.session(id));
        return 3;
      }
      export const readSpacesLeft = (id: string) =>
        readRemoteOrFallback(() => spacesLeft(id), () => Promise.resolve(3));`,
    ],
    [
      'an inline remote function handed straight to the wrapper',
      `${wrapperImport}
      export const readSpacesLeft = (id: string) =>
        readRemoteOrFallback(
          async () => {
            'use cache: remote';
            cacheLife('spacesLeft');
            cacheTag(tags.session(id));
            return 3;
          },
          () => Promise.resolve(3),
        );`,
    ],
  ])('accepts %s', (_name, source) => {
    expect(check(source)).toEqual([]);
  });

  it.each([
    [
      'no cacheLife',
      `async function f() { 'use cache'; cacheTag(tags.home); }`,
      'does not call cacheLife',
    ],
    [
      'a profile that does not exist',
      `async function f() { 'use cache'; cacheLife('weeks'); cacheTag(tags.home); }`,
      'cacheLife takes one of',
    ],
    [
      'an inline cacheLife object',
      `async function f() { 'use cache'; cacheLife({ revalidate: 5 }); cacheTag(tags.home); }`,
      'cacheLife takes one of',
    ],
    [
      'a cacheLife name held in a variable',
      `async function f(name: string) { 'use cache'; cacheLife(name); cacheTag(tags.home); }`,
      'cacheLife takes one of',
    ],
    [
      'no cacheTag',
      `async function f() { 'use cache'; cacheLife('editorial'); }`,
      'does not call cacheTag',
    ],
    [
      'a tag typed in place',
      `async function f() { 'use cache'; cacheLife('editorial'); cacheTag('home'); }`,
      'tag module',
    ],
    [
      'a tag built from a template string',
      "async function f(id: string) { 'use cache'; cacheLife('editorial'); cacheTag(`x-${id}`); }",
      'tag module',
    ],
    [
      'a file-level directive',
      `'use cache';\nexport async function f() { cacheLife('editorial'); cacheTag(tags.home); }`,
      'file-level',
    ],
    [
      'a private cache',
      `async function f() { 'use cache: private'; cacheLife('editorial'); cacheTag(tags.home); }`,
      'reads the caller',
    ],
    [
      'an exported remote function',
      `${wrapperImport}
      export async function f() { 'use cache: remote'; cacheLife('spacesLeft'); cacheTag(tags.home); }`,
      'stays private',
    ],
    [
      'a remote function exported in a list',
      `${wrapperImport}
      async function f() { 'use cache: remote'; cacheLife('spacesLeft'); cacheTag(tags.home); }
      export { f };`,
      'read it only inside the first argument',
    ],
    [
      'a remote function exported by default',
      `${wrapperImport}
      async function f() { 'use cache: remote'; cacheLife('spacesLeft'); cacheTag(tags.home); }
      export default f;`,
      'read it only inside the first argument',
    ],
    [
      'a default-exported remote declaration',
      `${wrapperImport}
      export default async function f() { 'use cache: remote'; cacheLife('spacesLeft'); cacheTag(tags.home); }`,
      'stays private',
    ],
    [
      'an anonymous default-exported remote function',
      `${wrapperImport}
      export default async () => { 'use cache: remote'; cacheLife('spacesLeft'); cacheTag(tags.home); };`,
      'stays private',
    ],
    [
      'a remote method on an exported object',
      `${wrapperImport}
      export const reads = {
        async spaces() { 'use cache: remote'; cacheLife('spacesLeft'); cacheTag(tags.home); },
      };`,
      'not a method or object property',
    ],
    [
      'a remote arrow assigned to an object property',
      `${wrapperImport}
      export const reads = {
        spaces: async () => { 'use cache: remote'; cacheLife('spacesLeft'); cacheTag(tags.home); },
      };`,
      'not a method or object property',
    ],
    [
      'an unnamed remote function that is not handed to the wrapper',
      `${wrapperImport}
      void [async () => { 'use cache: remote'; cacheLife('spacesLeft'); cacheTag(tags.home); }];`,
      'has a name',
    ],
    [
      'a remote function called directly in a file that imports the wrapper',
      `${wrapperImport}
      async function f() { 'use cache: remote'; cacheLife('spacesLeft'); cacheTag(tags.home); }
      export const read = () => f();`,
      'read it only inside the first argument',
    ],
    [
      'a remote function called from the fallback instead of the remote argument',
      `${wrapperImport}
      async function f() { 'use cache: remote'; cacheLife('spacesLeft'); cacheTag(tags.home); }
      export const read = () => readRemoteOrFallback(() => Promise.resolve(1), () => f());`,
      'read it only inside the first argument',
    ],
    [
      'a remote function called beside a wrapped call',
      `${wrapperImport}
      async function f() { 'use cache: remote'; cacheLife('spacesLeft'); cacheTag(tags.home); }
      export const read = async () => {
        await readRemoteOrFallback(() => f(), () => Promise.resolve(1));
        return f();
      };`,
      'read it only inside the first argument',
    ],
    [
      'a remote function without the wrapper',
      `async function f() { 'use cache: remote'; cacheLife('spacesLeft'); cacheTag(tags.home); }`,
      'readRemoteOrFallback',
    ],
  ])('rejects %s', (_name, source, message) => {
    const problems = check(source);

    expect(problems).not.toEqual([]);
    expect(problems.join('\n')).toContain(message);
  });

  it('reports the line of the function', () => {
    const problems = check(
      `\n\nasync function f() {\n  'use cache';\n  cacheTag(tags.home);\n}`,
    );

    expect(problems[0]).toMatch(/^fixture\.ts:3 /);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [entryPath]
      : [];
  });
}

describe('the app source', () => {
  it('follows the cache conventions in every file', () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const problems = sourceFiles(path.join(root, 'src')).flatMap((file) =>
      cacheConventionViolations(
        path.relative(root, file),
        readFileSync(file, 'utf8'),
        profiles,
      ),
    );

    expect(problems).toEqual([]);
  });
});
