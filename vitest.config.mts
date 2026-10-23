import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // The real package throws outside React Server Components.
      'server-only': path.resolve(
        import.meta.dirname,
        'tests/stubs/server-only.ts',
      ),
    },
  },
  test: {
    setupFiles: ['./tests/setup.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'tests/**/*.test.{ts,tsx}'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          include: ['src/**/*.test.tsx'],
          environment: 'jsdom',
          // Testing Library registers its automatic cleanup only when afterEach is global.
          globals: true,
        },
      },
    ],
  },
});
