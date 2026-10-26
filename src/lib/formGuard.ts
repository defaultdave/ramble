import { z } from 'zod';

/** Not a name a browser or password manager recognises, so a real visitor never fills it. */
export const HONEYPOT_FIELD = 'fax';
export const FORM_TOKEN_FIELD = 'formToken';

/** A person needs longer than this to read a form and type into it. */
export const MIN_FILL_MS = 3_000;
/** A form left open longer than this must be reloaded. */
export const MAX_FORM_AGE_MS = 2 * 60 * 60 * 1000;

export const maxFieldLength = 256;

export const FormGuardFieldsSchema = z.object({
  [HONEYPOT_FIELD]: z.string().max(maxFieldLength).optional(),
  [FORM_TOKEN_FIELD]: z.string().min(1).max(maxFieldLength),
});

type FormGuardFailure =
  'honeypot_filled' | 'too_fast' | 'expired' | 'invalid_token';

export type FormGuardResult =
  { ok: true } | { ok: false; reason: FormGuardFailure };

/**
 * `issuedAt` is the time the form was rendered, read from a token the server signed. Order
 * matters: a filled honeypot is a bot whatever the clock says, and a future `issuedAt` (clock
 * skew between instances at worst, forgery at best) counts as too fast rather than passing.
 */
export function evaluateFormGuard(input: {
  honeypot: string | undefined;
  issuedAt: Date;
  now: Date;
}): FormGuardResult {
  if (input.honeypot) return { ok: false, reason: 'honeypot_filled' };
  const elapsed = input.now.getTime() - input.issuedAt.getTime();
  if (!Number.isFinite(elapsed)) return { ok: false, reason: 'invalid_token' };
  if (elapsed < MIN_FILL_MS) return { ok: false, reason: 'too_fast' };
  if (elapsed > MAX_FORM_AGE_MS) return { ok: false, reason: 'expired' };
  return { ok: true };
}
