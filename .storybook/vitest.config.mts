import path from 'node:path';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Runs every story in Chromium with axe; a violation fails the run (a11y.test is 'error').
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '../src') } },
  plugins: [storybookTest({ configDir: import.meta.dirname })],
  test: {
    name: 'storybook',
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});
