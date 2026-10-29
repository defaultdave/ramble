/** Reads `Authorization: Bearer <token>`; anything else is no token. */
export function bearerToken(header: string | null): string | null {
  const match = /^bearer ([!-~]{1,256})$/i.exec(header ?? '');
  return match?.[1] ?? null;
}
