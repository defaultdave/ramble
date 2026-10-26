import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Compares two secrets in constant time. Both sides are hashed first, so the comparison always
 * covers 32 bytes and a wrong length reveals nothing.
 */
export function secureEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}
