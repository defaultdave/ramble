import 'server-only';
import { randomUUID } from 'node:crypto';
import { signInLinkData } from '@/lib/signIn';
import { sendEmail } from '@/server/ports/email';

/** Sends the sign-in link email for `token`. Every send has its own idempotency key, as every link is its own message. */
export function sendSignInLinkEmail(
  email: string,
  token: string,
  origin: string,
  next: unknown,
) {
  return sendEmail({
    template: 'sign-in-link',
    to: email,
    data: signInLinkData(token, origin, next),
    idempotencyKey: `sign-in-link-${randomUUID()}`,
  });
}
