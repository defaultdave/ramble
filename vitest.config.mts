import path from 'node:path';
import { defineConfig } from 'vitest/config';

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
          include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
          exclude: ['**/*.db.test.ts', '**/node_modules/**'],
          setupFiles: ['./tests/setup.ts'],
          environment: 'node',
        },
      },
      {
        resolve,
        test: {
          name: 'db',
          include: ['src/**/*.db.test.ts'],
          environment: 'node',
          // The docker-compose database, unless the environment already points elsewhere.
          env: {
            DATABASE_URL_UNPOOLED:
              process.env.DATABASE_URL_UNPOOLED ??
              'postgres://ramble:ramble@localhost:5432/ramble',
          },
        },
      },
    ],
  },
});
