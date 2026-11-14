import type { Metadata } from 'next';
import { OpsAccessDenied } from '@/components/OpsShell';
import { SessionsList } from '@/components/OpsSessions';
import { PageHeading } from '@/components/PageHeading';
import { holdsOpsRole } from '@/lib/opsNav';
import {
  opsSessionsPath,
  parseSessionWhen,
  sessionListDirection,
} from '@/lib/opsSessions';
import { parseCursor, parseSearchTerm } from '@/lib/tableQuery';
import { readOpsSessions } from '@/server/db/opsSessions';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Sessions' };

export default async function SessionsPage({
  searchParams,
}: PageProps<'/ops/sessions'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={opsSessionsPath} />;
  }

  const cursor = parseCursor(query.cursor);
  const term = parseSearchTerm(query.q);
  const when = parseSessionWhen(query.status);
  const page = await readOpsSessions(caller, {
    when,
    term,
    cursor,
  });
  return (
    <PageHeading title="Sessions">
      <SessionsList
        rows={page.rows}
        query={query}
        term={term}
        direction={sessionListDirection(when)}
        cursor={cursor}
        nextCursor={page.nextCursor}
      />
    </PageHeading>
  );
}
