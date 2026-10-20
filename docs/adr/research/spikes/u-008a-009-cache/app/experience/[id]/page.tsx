import { Suspense } from 'react';
import { connection } from 'next/server';
import { getStamp, getSpacesLeft } from '@/lib/data';
import { Reserve } from './reserve';

export async function generateStaticParams() { return [{ id: '1' }, { id: '2' }]; }

async function Shell({ id }: { id: string }) {
  const s = await getStamp(`experience-${id}`);
  return <section><h1>Experience {id}</h1><p data-stamp>shell {s.ranAt} run {s.run}</p></section>;
}
async function Spaces({ id }: { id: string }) {
  await connection(); // request time, inside Suspense: the streamed hole
  try {
    const s = await getSpacesLeft(id);
    return <p data-spaces>spaces left {s.left} (ran {s.ranAt} run {s.run})</p>;
  } catch {
    // degraded mode: the real code falls back to a direct Postgres read here
    return <p data-spaces>spaces: fallback read</p>;
  }
}
export default async function Experience({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main>
      <Shell id={id} />
      <Suspense fallback={<p>loading spaces…</p>}><Spaces id={id} /></Suspense>
      <Reserve />
    </main>
  );
}
