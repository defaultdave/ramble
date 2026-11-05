import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const eslint = new ESLint({
  cwd: root,
  overrideConfig: tseslint.configs.disableTypeChecked,
});
const RULE = 'ramble/no-ticket-comments';

async function ruleIds(code: string) {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(root, 'src/lib/sample.ts'),
  });
  return result?.messages.map((message) => message.ruleId) ?? [];
}

describe(RULE, () => {
  it.each([
    ['a unit id', '// Added for U-123 so the cart keeps its row.\n'],
    ['a unit id with a suffix', '// Split out in U-074b.\n'],
    ['a PR number', '// Restored after #884 dropped it.\n'],
    ['a PR named in words', '// PR 162 moved this.\n'],
    ['an audit item', '/* Fixed in the W9b sweep. */\n'],
    ['a nightly item', '// Raised by P07.\n'],
    ['a decision id', '// See DEC:175.\n'],
    ['a TODO without its ticket', '// TODO: first caller\n'],
    [
      'a TODO without its ticket inside a JSDoc',
      '/**\n * Reads the cart.\n * TODO first caller\n */\n',
    ],
    [
      'a ticket before the TODO in the same JSDoc',
      '/**\n * Built for U-030.\n * TODO(U-074b): publish the tag\n */\n',
    ],
  ])('reports %s', async (_label, comment) => {
    expect(await ruleIds(`${comment}export const a = 1;\n`)).toContain(RULE);
  });

  it.each([
    ['a TODO naming its ticket', '// TODO(U-074b): first caller\n'],
    [
      'a TODO that wraps and names the tickets after it',
      '// TODO(U-004a): first caller; U-055 and U-043\n// follow.\n',
    ],
    [
      'a TODO at the end of a JSDoc',
      '/**\n * Shows the cover once the revalidate runs out.\n * TODO(U-074b): publish the tag\n */\n',
    ],
    ['an architecture rule id', '// Takes no caller (architecture rule B6).\n'],
    ['a checklist item', '/** The tone checklist (A10) rules these out. */\n'],
    ['a hex colour', '// Falls back to #fff on old browsers.\n'],
    ['the word TODO in prose', '// Reads a TODO that wraps as one comment.\n'],
  ])('allows %s', async (_label, comment) => {
    expect(await ruleIds(`${comment}export const a = 1;\n`)).not.toContain(
      RULE,
    );
  });
});
