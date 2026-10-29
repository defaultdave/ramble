import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const eslint = new ESLint({
  cwd: root,
  overrideConfig: tseslint.configs.disableTypeChecked,
});

async function ruleIds(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(root, filePath),
  });
  return result?.messages.map((message) => message.ruleId) ?? [];
}

const PATHS = 'import/no-restricted-paths';
const importsHome =
  "import { homeLimits } from '@/lib/pages/home';\nexport const a = homeLimits;\n";

describe('the pages zone', () => {
  it.each([
    ['a shared lib module', 'src/lib/bad.ts'],
    ['a shared lib module in a folder', 'src/lib/richText/bad.ts'],
  ])('refuses %s importing a page module', async (_name, filePath) => {
    expect(await ruleIds(filePath, importsHome)).toContain(PATHS);
  });

  it('refuses a relative import of a page module', async () => {
    expect(
      await ruleIds(
        'src/lib/bad.ts',
        "import { homeLimits } from './pages/home';\nexport const a = homeLimits;\n",
      ),
    ).toContain(PATHS);
  });

  it.each([
    ['the seed', 'src/lib/seed/x.ts'],
    ['a lib test', 'src/lib/x.test.ts'],
    ['a page module', 'src/lib/pages/x.ts'],
    ['the data layer', 'src/server/x.ts'],
    ['a component', 'src/components/X.tsx'],
    ['the app', 'src/app/x.tsx'],
  ])('lets %s import a page module', async (_name, filePath) => {
    expect(await ruleIds(filePath, importsHome)).not.toContain(PATHS);
  });
});
