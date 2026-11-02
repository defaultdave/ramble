import localFont from 'next/font/local';

const fraunces = localFont({
  src: '../fonts/fraunces-latin-wght-normal.woff2',
  variable: '--font-face-fraunces',
  weight: '100 900',
  display: 'swap',
  adjustFontFallback: false,
  fallback: [
    'Fraunces Fallback',
    'Fraunces Fallback Android',
    'Georgia',
    'serif',
  ],
});

const inter = localFont({
  src: '../fonts/inter-latin-wght-normal.woff2',
  variable: '--font-face-inter',
  weight: '100 900',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

export const fontVariables = `${fraunces.variable} ${inter.variable}`;
