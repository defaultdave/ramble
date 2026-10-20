import { revalidateTag } from 'next/cache';
import { NextRequest } from 'next/server';
export async function POST(req: NextRequest) {
  const tag = req.nextUrl.searchParams.get('tag')!;
  const mode = req.nextUrl.searchParams.get('mode') ?? 'max';
  if (mode === 'expire') revalidateTag(tag, { expire: 0 });
  else revalidateTag(tag, 'max');
  return Response.json({ tag, mode });
}
