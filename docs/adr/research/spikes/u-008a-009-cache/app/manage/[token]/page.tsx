import { Suspense } from 'react';
import { connection } from 'next/server';

async function Booking({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  return <h1>Manage {token}</h1>;
}
export default function Manage({ params }: { params: Promise<{ token: string }> }) {
  return <main><Suspense fallback={<p>loading…</p>}><Booking params={params} /></Suspense></main>;
}
