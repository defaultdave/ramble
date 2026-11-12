import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ExperienceEditView,
  ExperienceNotice,
} from '@/components/ExperienceEditor';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import {
  experiencePath,
  experiencesPath,
  parseExperienceIdField,
  parseExperienceNotice,
  parseProblemFields,
} from '@/lib/experienceEditor';
import { holdsOpsRole } from '@/lib/opsNav';
import { updateExperienceAction } from '@/server/actions/experiences';
import {
  readExperienceChoices,
  readExperienceForOps,
} from '@/server/db/experienceEditor';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Experience' };

export default async function ExperiencePage({
  params,
  searchParams,
}: PageProps<'/ops/experiences/[id]'>) {
  const [{ id }, query, caller] = await Promise.all([
    params,
    searchParams,
    readOpsCaller(),
  ]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={experiencePath(id)} />;
  }

  const experienceId = parseExperienceIdField(id);
  const [view, choices] = await Promise.all([
    experienceId === null ? null : readExperienceForOps(caller, experienceId),
    readExperienceChoices(caller),
  ]);
  if (view === null) notFound();

  return (
    <PageHeading title={view.content.name}>
      <p>
        <Link href={experiencesPath}>Back to the experiences</Link>
      </p>
      <ExperienceNotice code={parseExperienceNotice(query.notice)} />
      <ExperienceEditView
        view={view}
        choices={choices}
        problems={parseProblemFields(query.fields)}
        save={updateExperienceAction}
      />
    </PageHeading>
  );
}
