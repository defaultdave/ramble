import path from 'node:path';
import { defineConfig } from 'vitest/config';

const composeUrl = 'postgres://ramble:ramble@localhost:5432/ramble';

const resolve = {
  alias: {
    '@': path.resolve(import.meta.dirname, 'src'),
    // The real package throws outside React Server Components.
    'server-only': path.resolve(
      import.meta.dirname,
      'tests/stubs/server-only.ts',
    ),
  },
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'tests/**/*.test.{ts,tsx}'],
          exclude: ['**/*.db.test.ts', '**/node_modules/**'],
          setupFiles: ['./tests/setup.ts'],
          environment: 'node',
        },
      },
      {
        resolve,
        test: {
          name: 'components',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./tests/setup.ts'],
          environment: 'jsdom',
          // Testing Library registers its automatic cleanup only when afterEach is global.
          globals: true,
        },
      },
      {
        resolve,
        test: {
          name: 'db',
          include: ['src/**/*.db.test.ts', 'tests/**/*.db.test.ts'],
          environment: 'node',
          // The harness refuses any host that is not local.
          env: {
            DATABASE_URL_UNPOOLED:
              process.env.DATABASE_URL_UNPOOLED ?? composeUrl,
          },
        },
      },
    ],
  },
});
