import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { MailboxList, MailboxUnlockForm } from '@/components/DevMailbox';
import { PageHeading } from '@/components/PageHeading';
import { unlockDevMailbox } from '@/server/actions/mailbox';
import { readOpsCaller } from '@/server/opsCaller';
import { loadMailbox, mailboxCookieName } from '@/server/ports/email/mailbox';

export const metadata: Metadata = { title: 'Dev mailbox' };

export default async function MailboxPage({
  searchParams,
}: PageProps<'/ops/mailbox'>) {
  const [jar, query, caller] = await Promise.all([
    cookies(),
    searchParams,
    readOpsCaller(),
  ]);
  const mailbox = await loadMailbox(caller, jar.get(mailboxCookieName)?.value);

  return (
    <PageHeading title="Dev mailbox">
      {mailbox.status === 'disabled' ? (
        <p>The dev mailbox is not available here.</p>
      ) : null}
      {mailbox.status === 'locked' ? (
        <MailboxUnlockForm
          action={unlockDevMailbox}
          denied={query.denied !== undefined}
          limited={query.limited !== undefined}
        />
      ) : null}
      {mailbox.status === 'open' ? (
        <MailboxList messages={mailbox.messages} />
      ) : null}
    </PageHeading>
  );
}
