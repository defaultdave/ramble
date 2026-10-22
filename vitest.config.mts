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
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    environment: 'node',
  },
});
