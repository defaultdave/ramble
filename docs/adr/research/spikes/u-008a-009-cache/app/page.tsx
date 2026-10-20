import { getStamp } from '@/lib/data';
export default async function Home() {
  const s = await getStamp('home');
  return <main><h1>Home</h1><p data-stamp>{s.ranAt} run {s.run}</p></main>;
}
