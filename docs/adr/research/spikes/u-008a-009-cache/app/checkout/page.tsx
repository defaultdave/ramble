import { Suspense } from 'react';
import { headers } from 'next/headers';
import Script from 'next/script';

async function Nonce() {
  const nonce = (await headers()).get('x-nonce');
  return (
    <>
      <p data-nonce>{nonce}</p>
      <Script id="inline-ok" nonce={nonce ?? undefined} strategy="afterInteractive">{`document.title='script-ran'`}</Script>
    </>
  );
}
export default function Checkout() {
  return <main><h1>Checkout</h1><Suspense fallback={<p>…</p>}><Nonce /></Suspense></main>;
}
