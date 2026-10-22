import commentsPlugin from '@eslint-community/eslint-plugin-eslint-comments';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';
import {
  boundaryConfigs,
  withTypeImportsAllowed,
} from './eslint.config.boundaries.mjs';

export default defineConfig([
  ...withTypeImportsAllowed([...nextVitals, ...nextTypescript]),
  {
    name: 'ramble/base',
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.json', alwaysTryTypes: true },
        node: true,
      },
    },
    rules: {
      eqeqeq: ['error', 'always'],
    },
  },
  ...tseslint.configs.strictTypeChecked,
  {
    name: 'ramble/typescript-project',
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    name: 'ramble/typescript-untyped-config-files',
    files: ['**/*.mjs'],
  },
  ...boundaryConfigs,
  {
    name: 'ramble/no-inline-disables-of-boundaries',
    plugins: { '@eslint-community/eslint-comments': commentsPlugin },
    rules: {
      '@eslint-community/eslint-comments/no-restricted-disable': [
        'error',
        'import/no-restricted-paths',
        'no-restricted-imports',
        'no-restricted-syntax',
      ],
    },
  },
  prettier,
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'coverage/**',
    'test-results/**',
    'playwright-report/**',
    'next-env.d.ts',
    // Not part of the app: other units and the planning method own these.
    '.claude/**',
    'docs/**',
    'scripts/**',
  ]),
]);
