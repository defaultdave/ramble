import { notFound } from 'next/navigation';
import { connection } from 'next/server';

/**
 * Pins a route tree to per-request rendering. A layout that renders this gets no prerendered
 * shell, so every script tag carries the request's CSP nonce. It sits beside the page rather
 * than ahead of it (a layout that awaited `connection()` itself would do) so the page still
 * renders in the first streaming stage.
 */
export async function RenderPerRequest() {
  await connection();
  return null;
}

/**
 * The catch-all page of a per-request tree. A `notFound()` thrown before the request is read
 * is captured at build time as a static 404 shell whose scripts carry no nonce, so the
 * enforcing policy would block them. Read after the request, it renders the tree's own
 * not-found page with the nonce; the status is then 200, because a render resumed from the
 * route's empty shell cannot change it.
 */
export async function notFoundPerRequest(): Promise<never> {
  await connection();
  notFound();
}
