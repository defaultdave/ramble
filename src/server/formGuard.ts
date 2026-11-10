import 'server-only';
import { createHmac } from 'node:crypto';
import { secureEqual } from '@/server/hash';
import {
  evaluateFormGuard,
  FORM_TOKEN_FIELD,
  FormGuardFieldsSchema,
  HONEYPOT_FIELD,
  parseFormGuardToken,
  pickFormGuardSecret,
  type FormGuardResult,
} from '@/lib/formGuard';
import { env } from '@/server/env';

function sign(issuedAtMs: string): string {
  const secret = pickFormGuardSecret(env.FORM_GUARD_SECRET, env.NODE_ENV);
  if (secret === null) throw new Error('FORM_GUARD_SECRET is not set');
  return createHmac('sha256', secret).update(issuedAtMs).digest('base64url');
}

/**
 * `<issued at, ms>.<HMAC-SHA-256, base64url>`: a bot cannot back-date it to skip the minimum fill time.
 * Render it into `FormGuardFields` as `token`, so the time starts when the form is rendered.
 */
export function issueFormGuardToken(now: Date): string {
  const issuedAtMs = String(now.getTime());
  return `${issuedAtMs}.${sign(issuedAtMs)}`;
}

function signatureMatches(issuedAtMs: string, signature: string): boolean {
  return secureEqual(signature, sign(issuedAtMs));
}

/**
 * Judges a submitted guest form: honeypot empty, token genuine, filled in no faster than a person
 * could and not left open for hours. On any failure the caller returns the same reply a success
 * gets (so a bot learns nothing) and writes nothing; `expired` alone may ask the guest to reload.
 * Takes the form's fields as they arrive, so it validates before it reads them.
 */
export function checkFormGuard(fields: unknown, now: Date): FormGuardResult {
  const parsed = FormGuardFieldsSchema.safeParse(fields);
  if (!parsed.success) return { ok: false, reason: 'invalid_token' };
  const token = parseFormGuardToken(parsed.data[FORM_TOKEN_FIELD]);
  if (!token || !signatureMatches(token.issuedAtMs, token.signature)) {
    return { ok: false, reason: 'invalid_token' };
  }
  return evaluateFormGuard({
    honeypot: parsed.data[HONEYPOT_FIELD],
    issuedAt: token.issuedAt,
    now,
  });
}
