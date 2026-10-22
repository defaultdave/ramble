import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// One bad fixture per boundary rule, linted with the real config. If someone weakens a rule,
// its fixture stops failing and this test fails CI.

const root = path.resolve(import.meta.dirname, '..');
const eslint = new ESLint({ cwd: root });

async function ruleIds(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(root, filePath),
  });
  return result?.messages.map((message) => message.ruleId) ?? [];
}

const PATHS = 'import/no-restricted-paths';
const IMPORTS = 'no-restricted-imports';
const SYNTAX = 'no-restricted-syntax';
const DISABLES = '@eslint-community/eslint-comments/no-restricted-disable';

describe('import/no-restricted-paths', () => {
  it.each([
    [
      'lib imports server (alias)',
      'src/lib/bad.ts',
      "import { env } from '@/server/env';\nexport const a = env;\n",
    ],
    [
      'lib imports server (relative)',
      'src/lib/bad.ts',
      "import { env } from '../server/env';\nexport const a = env;\n",
    ],
    [
      'lib imports components',
      'src/lib/bad.ts',
      "import { PageHeading } from '@/components/PageHeading';\nexport const a = PageHeading;\n",
    ],
    [
      'lib imports app',
      'src/lib/bad.ts',
      "import RootLayout from '@/app/layout';\nexport const a = RootLayout;\n",
    ],
    [
      'components import app',
      'src/components/Bad.tsx',
      "import RootLayout from '@/app/layout';\nexport const a = RootLayout;\n",
    ],
    [
      'components import server outside actions',
      'src/components/Bad.tsx',
      "import { env } from '@/server/env';\nexport const a = env;\n",
    ],
    [
      'components import server (relative)',
      'src/components/Bad.tsx',
      "import { env } from '../server/env';\nexport const a = env;\n",
    ],
    [
      'components import a type specifier and a value from server',
      'src/components/Bad.tsx',
      "import { type env as Env, env } from '@/server/env';\nexport const a: typeof Env = env;\n",
    ],
    [
      'server imports app',
      'src/server/bad.ts',
      "import RootLayout from '@/app/layout';\nexport const a = RootLayout;\n",
    ],
    [
      'server imports components',
      'src/server/bad.ts',
      "import { PageHeading } from '@/components/PageHeading';\nexport const a = PageHeading;\n",
    ],
  ])('rejects: %s', async (_name, filePath, code) => {
    expect(await ruleIds(filePath, code)).toContain(PATHS);
  });

  it.each([
    [
      'import type',
      "import type { env } from '@/server/env';\nexport type A = typeof env;\n",
    ],
    [
      'inline type specifier',
      "import { type env } from '@/server/env';\nexport type A = typeof env;\n",
    ],
    ['export type from', "export type { env } from '@/server/env';\n"],
  ])('allows a type-only import across layers: %s', async (_name, code) => {
    expect(await ruleIds('src/components/Ok.tsx', code)).not.toContain(PATHS);
  });

  it('allows the app to import every layer', async () => {
    const code =
      "import { env } from '@/server/env';\nimport { PageHeading } from '@/components/PageHeading';\nexport const a = [env, PageHeading];\n";
    expect(await ruleIds('src/app/ok.tsx', code)).not.toContain(PATHS);
  });
});

describe('no-restricted-imports', () => {
  it.each(['react', 'react-dom/client', 'next/navigation', 'server-only'])(
    'rejects %s in src/lib',
    async (pkg) => {
      expect(
        await ruleIds(
          'src/lib/bad.ts',
          `import * as x from '${pkg}';\nexport const a = x;\n`,
        ),
      ).toContain(IMPORTS);
    },
  );

  const sdks = [
    'drizzle-orm',
    'drizzle-orm/pg-core',
    '@neondatabase/serverless',
    'better-auth',
    'stripe',
    'resend',
    '@vercel/blob',
    '@sentry/nextjs',
    'botid',
    'web-vitals',
  ];

  it.each(sdks)(
    'rejects vendor SDK %s in src/lib, src/components, and src/server outside wrappers',
    async (sdk) => {
      const code = `import * as x from '${sdk}';\nexport const a = x;\n`;
      expect(await ruleIds('src/lib/bad.ts', code)).toContain(IMPORTS);
      expect(await ruleIds('src/components/Bad.tsx', code)).toContain(IMPORTS);
      expect(await ruleIds('src/server/bad.ts', code)).toContain(IMPORTS);
    },
  );

  it.each([
    'src/server/db/ok.ts',
    'src/server/auth/ok.ts',
    'src/server/ports/payments/ok.ts',
    'src/server/analytics/ok.ts',
    'src/server/monitoring/ok.ts',
  ])('allows vendor SDKs inside the wrapper folder %s', async (filePath) => {
    expect(
      await ruleIds(
        filePath,
        "import * as x from 'stripe';\nexport const a = x;\n",
      ),
    ).not.toContain(IMPORTS);
  });
});

describe('no-restricted-syntax (time comes from the clock)', () => {
  it.each([
    [
      'Date.now() in server',
      'src/server/bad.ts',
      'export const a = Date.now();\n',
    ],
    ['Date.now() in lib', 'src/lib/bad.ts', 'export const a = Date.now();\n'],
    [
      'new Date() in server',
      'src/server/bad.ts',
      'export const a = new Date();\n',
    ],
    ['new Date() in lib', 'src/lib/bad.ts', 'export const a = new Date();\n'],
  ])('rejects %s', async (_name, filePath, code) => {
    expect(await ruleIds(filePath, code)).toContain(SYNTAX);
  });

  it.each([
    [
      'the clock port',
      'src/server/ports/clock/system.ts',
      'export const a = [Date.now(), new Date()];\n',
    ],
    [
      'a Date built from an argument',
      'src/server/ok.ts',
      'export const a = new Date(0);\n',
    ],
    [
      'code outside server and lib',
      'src/app/ok.tsx',
      'export const a = Date.now();\n',
    ],
  ])('allows %s', async (_name, filePath, code) => {
    expect(await ruleIds(filePath, code)).not.toContain(SYNTAX);
  });
});

describe('eslint-comments/no-restricted-disable', () => {
  it.each([
    [
      'import/no-restricted-paths',
      "// eslint-disable-next-line import/no-restricted-paths\nimport { env } from '@/server/env';\nexport const a = env;\n",
    ],
    [
      'no-restricted-imports',
      "// eslint-disable-next-line no-restricted-imports\nimport * as x from 'react';\nexport const a = x;\n",
    ],
    [
      'no-restricted-syntax',
      '// eslint-disable-next-line no-restricted-syntax\nexport const a = Date.now();\n',
    ],
    [
      'a blanket disable',
      '/* eslint-disable */\nexport const a = Date.now();\n',
    ],
  ])('rejects an inline disable of %s', async (_name, code) => {
    expect(await ruleIds('src/lib/bad.ts', code)).toContain(DISABLES);
  });

  it('reports a disable directive that suppresses nothing', async () => {
    const ids = await ruleIds(
      'src/lib/ok.ts',
      '// eslint-disable-next-line eqeqeq\nexport const a = 1;\n',
    );
    expect(ids).toContain(null);
  });
});
