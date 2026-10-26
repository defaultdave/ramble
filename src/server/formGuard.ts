import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  evaluateFormGuard,
  FORM_TOKEN_FIELD,
  FormGuardFieldsSchema,
  HONEYPOT_FIELD,
  type FormGuardResult,
} from '@/lib/formGuard';
import { env } from '@/server/env';

// A fixed value is safe here only because it is used where nothing is deployed.
const DEVELOPMENT_SECRET = 'development-only-form-guard-secret-0000';

function secret(): string {
  if (env.FORM_GUARD_SECRET) return env.FORM_GUARD_SECRET;
  if (env.NODE_ENV !== 'production') return DEVELOPMENT_SECRET;
  throw new Error('FORM_GUARD_SECRET is not set');
}

function sign(issuedAtMs: string): Buffer {
  return createHmac('sha256', secret()).update(issuedAtMs).digest();
}

// TODO(U-038): first caller, the contact form page; U-043 follows. Render it into
// `FormGuardFields` as `token`, so the time starts when the form is rendered.
/** `<issued at, ms>.<HMAC-SHA-256, base64url>`: a bot cannot back-date it to skip the minimum fill time. */
export function issueFormGuardToken(now: Date): string {
  const issuedAtMs = String(now.getTime());
  return `${issuedAtMs}.${sign(issuedAtMs).toString('base64url')}`;
}

function readIssuedAt(token: string): Date | null {
  const [issuedAtMs, signature, ...rest] = token.split('.');
  if (!issuedAtMs || !signature || rest.length > 0) return null;
  if (!/^\d{1,15}$/.test(issuedAtMs)) return null;
  const given = Buffer.from(signature, 'base64url');
  const expected = sign(issuedAtMs);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  return new Date(Number(issuedAtMs));
}

// TODO(U-038): first caller, `submitSupportRequest`; U-043 (`requestPrivateSession`) follows.
/**
 * Judges a submitted guest form: honeypot empty, token genuine, filled in no faster than a person
 * could and not left open for hours. On any failure the caller returns the same reply a success
 * gets (so a bot learns nothing) and writes nothing; `expired` alone may ask the guest to reload.
 * Takes the form's fields as they arrive, so it validates before it reads them.
 */
export function checkFormGuard(fields: unknown, now: Date): FormGuardResult {
  const parsed = FormGuardFieldsSchema.safeParse(fields);
  if (!parsed.success) return { ok: false, reason: 'invalid_token' };
  const issuedAt = readIssuedAt(parsed.data[FORM_TOKEN_FIELD]);
  if (!issuedAt) return { ok: false, reason: 'invalid_token' };
  return evaluateFormGuard({
    honeypot: parsed.data[HONEYPOT_FIELD],
    issuedAt,
    now,
  });
}
