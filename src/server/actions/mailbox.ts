'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
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
  if (token === null) redirect(`${mailboxPath}?denied=1`);

  (await cookies()).set(mailboxCookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    path: mailboxPath,
    maxAge: mailboxCookieMaxAgeSeconds,
  });
  redirect(mailboxPath);
}
