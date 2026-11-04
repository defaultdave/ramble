import { describe, expect, it } from 'vitest';
import { importsOf } from './importGraph';

// Behaviours under test, one per decision, branch or risk:
// - static, side-effect, re-export, multi-line and dynamic imports are found
// - a type-only import is left out
// - an import inside a line comment, a block comment, or a string is not found

describe('importsOf', () => {
  it.each([
    ['a named import', "import { a } from 'x';", ['x']],
    ['a side-effect import', "import 'x';", ['x']],
    ['a re-export', "export * from 'x';", ['x']],
    ['a multi-line import', "import {\n  a,\n  b,\n} from 'x';", ['x']],
    ['a dynamic import', "const m = await import('x');", ['x']],
    ['a dynamic import in a call', "load(import('x'));", ['x']],
    ['two imports on one line', "import 'a'; import 'b';", ['a', 'b']],
    [
      'two dynamic imports in one call',
      "x(import('a'), import('b'));",
      ['a', 'b'],
    ],
    [
      'two re-exports on one line',
      "export { a } from 'x'; export { b } from 'y';",
      ['x', 'y'],
    ],
    [
      'a string argument before the import',
      "lazy('n', () => import('./x'));",
      ['./x'],
    ],
    [
      'a real import after a glob string holding a comment opener',
      "const glob = 'src/**/*.ts';\nconst more = 'a/*';\nimport 'real';\nconst end = '*/';",
      ['real'],
    ],
    [
      'an import after a regex literal holding a quote',
      "const r = /'/;\nimport 'a';",
      ['a'],
    ],
    [
      'a regex literal holding a backtick and a comment opener',
      "const r = /`\\/*/;\nimport 'a';",
      ['a'],
    ],
    [
      'a dynamic import after JSX text with an apostrophe',
      "const a = <p>Don't</p>;\nconst b = () => import('z');\nconst c = <p>it's</p>;",
      ['z'],
    ],
    [
      'a dynamic import inside a template expression',
      "const t = `${await import('a')}`;",
      ['a'],
    ],
    [
      'an import with a type-named specifier',
      "import { type A, b } from 'x';",
      ['x'],
    ],
  ])('finds %s', (_name, text, expected) => {
    expect(importsOf(text, 'module.tsx')).toEqual(expected);
  });

  it('leaves out a type-only import', () => {
    expect(
      importsOf("import type { A } from 'a';\nimport 'b';", 'module.tsx'),
    ).toEqual(['b']);
  });

  it('leaves out a type-only re-export', () => {
    expect(
      importsOf(
        "export type { A } from 'a';\nexport * from 'b';",
        'module.tsx',
      ),
    ).toEqual(['b']);
  });

  it.each([
    [
      'a .ts file with a generic arrow before a dynamic import',
      "import 'a'; const id = <T>(x: T) => x; const m = () => import('after');",
      'module.ts',
      ['a', 'after'],
    ],
    [
      'a .ts file with a type assertion before a static import',
      "const a = <string>x;\nimport 'r';",
      'module.ts',
      ['r'],
    ],
    [
      'a .tsx file with JSX text before a dynamic import',
      "const a = <p>Don't</p>;\nconst m = () => import('z');",
      'module.tsx',
      ['z'],
    ],
  ])('reads %s by its extension', (_name, text, fileName, expected) => {
    expect(importsOf(text, fileName)).toEqual(expected);
  });

  it.each([
    ['a typeof import type', "type A = typeof import('x');"],
    ['an import type with a member', "type A = import('x').Foo;"],
    [
      'a typeof import in a type argument',
      "const m = await load<typeof import('x')>();",
    ],
  ])('leaves out %s', (_name, text) => {
    expect(importsOf(`${text}\nimport 'real';`, 'module.ts')).toEqual(['real']);
  });

  it.each([
    ['a line comment', "// import { a } from 'x';\nimport 'real';"],
    ['an indented line comment', "  // import 'x';\nimport 'real';"],
    ['a block comment', "/*\nimport 'x';\n*/\nimport 'real';"],
    ['a doc comment', "/** Use `import 'x'` here. */\nimport 'real';"],
    ['a template literal', "const text = `import 'x'`;\nimport 'real';"],
    ['a string', "const text = \"import { a } from 'x'\";\nimport 'real';"],
  ])('does not find an import inside %s', (_name, text) => {
    expect(importsOf(text, 'module.tsx')).toEqual(['real']);
  });
});
