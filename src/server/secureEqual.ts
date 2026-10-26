import 'server-only';
import { timingSafeEqual } from 'node:crypto';

/**
 * Compares two secrets in constant time. Differing lengths are refused after a comparison of one
 * buffer with itself, so the work done does not depend on where the strings differ. The length can
 * leak, which these secrets accept: each has a fixed minimum length and is not a password.
 */
export function secureEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
