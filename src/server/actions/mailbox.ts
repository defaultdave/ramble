'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { consumeRateLimit } from '@/server/ports/rate-limit';
import { clientAddress } from '@/lib/clientAddress';
import { env } from '@/server/env';
import {
  mailboxCookieMaxAgeSeconds,
  mailboxCookieName,
  mailboxPath,
  unlockMailbox,
} from '@/server/ports/email/mailbox';

const UnlockFormSchema = z.object({ secret: z.string().max(256) });

export async function unlockDevMailbox(formData: FormData): Promise<void> {
  const form = UnlockFormSchema.safeParse({ secret: formData.get('secret') });
  const token = form.success ? unlockMailbox(form.data.secret) : null;

  if (token === null) {
    // Only a wrong secret is counted, and against the caller's own address, so nobody else's
    // attempts can lock the owner out, and the right secret is never refused.
    const failures = await consumeRateLimit(
      'mailbox_unlock_failed',
      clientAddress((await headers()).get('x-forwarded-for')),
    );
    redirect(`${mailboxPath}?${failures.allowed ? 'denied' : 'limited'}=1`);
  }

  (await cookies()).set(mailboxCookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    path: mailboxPath,
    maxAge: mailboxCookieMaxAgeSeconds,
  });
  redirect(mailboxPath);
}
