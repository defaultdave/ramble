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
  ])('finds %s', (_name, text, expected) => {
    expect(importsOf(text)).toEqual(expected);
  });

  it('leaves out a type-only import', () => {
    expect(importsOf("import type { A } from 'a';\nimport 'b';")).toEqual([
      'b',
    ]);
  });

  it.each([
    ['a line comment', "// import { a } from 'x';\nimport 'real';"],
    ['an indented line comment', "  // import 'x';\nimport 'real';"],
    ['a block comment', "/*\nimport 'x';\n*/\nimport 'real';"],
    ['a doc comment', "/** Use `import 'x'` here. */\nimport 'real';"],
    ['a template literal', "const text = `import 'x'`;\nimport 'real';"],
    ['a string', "const text = \"import { a } from 'x'\";\nimport 'real';"],
  ])('does not find an import inside %s', (_name, text) => {
    expect(importsOf(text)).toEqual(['real']);
  });
});
