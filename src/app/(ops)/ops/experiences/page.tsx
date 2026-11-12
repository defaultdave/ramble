import type { Metadata } from 'next';
import { ButtonLink } from '@/components/Button';
import {
  ExperienceNotice,
  ExperiencesList,
} from '@/components/ExperienceEditor';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import {
  experiencesPath,
  newExperiencePath,
  parseExperienceFilters,
  parseExperienceNotice,
} from '@/lib/experienceEditor';
import { holdsOpsRole } from '@/lib/opsNav';
import { parseCursor } from '@/lib/tableQuery';
import {
  readExperienceChoices,
  readExperiencesForOps,
} from '@/server/db/experienceEditor';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Experiences' };

export default async function ExperiencesPage({
  searchParams,
}: PageProps<'/ops/experiences'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={experiencesPath} />;
  }

  const cursor = parseCursor(query.cursor);
  const choices = await readExperienceChoices(caller);
  const filters = parseExperienceFilters(query, choices);
  const page = await readExperiencesForOps(caller, filters, cursor);
  return (
    <PageHeading title="Experiences">
      <ExperienceNotice code={parseExperienceNotice(query.notice)} />
      <p>
        <ButtonLink href={newExperiencePath}>Add an experience</ButtonLink>
      </p>
      <ExperiencesList
        rows={page.rows}
        query={query}
        filters={filters}
        hosts={choices.hosts}
        categories={choices.categories}
        cursor={cursor}
        nextCursor={page.nextCursor}
      />
    </PageHeading>
  );
}
