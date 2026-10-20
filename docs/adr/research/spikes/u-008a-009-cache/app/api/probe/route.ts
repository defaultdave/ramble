import { connection } from 'next/server';
import { counters } from '@/lib/data';
export async function GET() { await connection(); return Response.json(counters()); }
