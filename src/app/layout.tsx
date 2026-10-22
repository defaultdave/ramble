import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import '@/styles/tokens.css';

const fraunces = localFont({
  src: '../fonts/fraunces-latin-wght-normal.woff2',
  variable: '--font-face-fraunces',
  weight: '100 900',
  display: 'swap',
  fallback: ['Georgia', 'serif'],
});

const inter = localFont({
  src: '../fonts/inter-latin-wght-normal.woff2',
  variable: '--font-face-inter',
  weight: '100 900',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'Ramble',
  description: 'A marketplace for things worth doing.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
