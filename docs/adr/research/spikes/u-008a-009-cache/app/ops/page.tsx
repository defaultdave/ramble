import { headers } from 'next/headers';
import Script from 'next/script';
import { Reserve } from '../experience/[id]/reserve';

// Fully dynamic: no static shell, so every script gets the request's nonce.
export const instant = false;

export default async function Ops() {
  const nonce = (await headers()).get('x-nonce');
  return (
    <main>
      <h1>Ops</h1>
      <p data-nonce>{nonce}</p>
      <Reserve />
      <Script id="inline-ok" nonce={nonce ?? undefined} strategy="afterInteractive">{`document.title='script-ran'`}</Script>
    </main>
  );
}
