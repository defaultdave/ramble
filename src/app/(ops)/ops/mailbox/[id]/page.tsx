import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MailboxMessageView } from '@/components/DevMailbox';
import { PageHeading } from '@/components/PageHeading';
import {
  loadMailboxMessage,
  mailboxCookieName,
  mailboxPath,
} from '@/server/ports/email/mailbox';

export const metadata: Metadata = { title: 'Dev mailbox message' };

export default async function MailboxMessagePage({
  params,
}: PageProps<'/ops/mailbox/[id]'>) {
  const [jar, { id }] = await Promise.all([cookies(), params]);
  const result = await loadMailboxMessage(
    jar.get(mailboxCookieName)?.value,
    id,
  );
  // A locked or off mailbox looks like any other missing page.
  if (result.status !== 'open') notFound();

  return (
    <PageHeading title="Dev mailbox message">
      <p>
        <Link href={mailboxPath}>Back to the mailbox</Link>
      </p>
      <MailboxMessageView message={result.message} />
    </PageHeading>
  );
}
