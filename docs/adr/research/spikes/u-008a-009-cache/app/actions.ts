'use server';
import { updateTag, revalidateTag } from 'next/cache';
export async function publishNow(tag: string) { updateTag(tag); }
export async function publishSwr(tag: string) { revalidateTag(tag, 'max'); }
export async function publishExpire(tag: string) { revalidateTag(tag, { expire: 0 }); }
