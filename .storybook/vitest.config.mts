import path from 'node:path';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const resolve = {
  alias: {
    '@': path.resolve(import.meta.dirname, '../src'),
    // The real package throws outside React Server Components, as RichText imports it.
    'server-only': path.resolve(
      import.meta.dirname,
      '../tests/stubs/server-only.ts',
    ),
  },
};
const browser = () => ({
  enabled: true,
  headless: true,
  provider: playwright(),
  instances: [{ browser: 'chromium' as const }],
});

// Two projects in Chromium. "storybook" runs every story with axe; a violation fails the run
// (a11y.test is 'error'). "forced-colors" renders components and presses real Tab keys under
// forced-colors emulation, which a story cannot do: the emulation is a Playwright page setting.
export default defineConfig({
  test: {
    projects: [
      {
        resolve,
        plugins: [storybookTest({ configDir: import.meta.dirname })],
        test: { name: 'storybook', browser: browser() },
      },
      {
        resolve,
        test: {
          name: 'forced-colors',
          include: ['src/**/*.browser.tsx'],
          setupFiles: [
            path.resolve(import.meta.dirname, 'forced-colors.setup.ts'),
          ],
          browser: {
            ...browser(),
            commands: {
              setForcedColors: async (context, active: boolean) => {
                await context.page.emulateMedia({
                  forcedColors: active ? 'active' : 'none',
                });
              },
            },
          },
        },
      },
    ],
  },
});
