import type { StorybookConfig } from '@storybook/nextjs-vite';

const config: StorybookConfig = {
  stories: ['../src/components/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-vitest'],
  framework: '@storybook/nextjs-vite',
};

export default config;
