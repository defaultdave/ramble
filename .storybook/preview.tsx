import type { Preview } from '@storybook/nextjs-vite';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import '../src/styles/tokens.css';
import { withColorSchemes } from './color-schemes';

// next/font is not available here, so point the font variables at the Fontsource families.
const fontVariables = document.createElement('style');
fontVariables.textContent = `:root { --font-face-fraunces: 'Fraunces Variable'; --font-face-inter: 'Inter Variable'; }`;
document.head.append(fontVariables);

const preview: Preview = {
  decorators: [withColorSchemes],
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
};

export default preview;
