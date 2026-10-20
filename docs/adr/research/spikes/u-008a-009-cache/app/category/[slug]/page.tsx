import { getStamp } from '@/lib/data';
export async function generateStaticParams() { return [{ slug: 'kayak' }, { slug: 'food' }]; }
export default async function Category({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await getStamp(`category-${slug}`);
  return <main><h1>Category {slug}</h1><p data-stamp>{s.ranAt} run {s.run}</p></main>;
}
