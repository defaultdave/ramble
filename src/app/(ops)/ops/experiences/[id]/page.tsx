import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import {
  ExperienceEditView,
  ExperiencePauseForm,
} from '@/components/ExperienceEditor';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { availabilityPath } from '@/lib/availability';
import {
  experienceFormFields,
  experiencePath,
  experiencesPath,
} from '@/lib/experienceEditor';
import { parseIdField, parseProblemFields } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { experiencePageNotice, photoFormFields } from '@/lib/photoForm';
import {
  pauseExperienceAction,
  unpauseExperienceAction,
} from '@/server/actions/experiencePause';
import { updateExperienceAction } from '@/server/actions/experiences';
import { addExperiencePhotoAction } from '@/server/actions/experiencePhotos';
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

  const experienceId = parseIdField(id);
  const [view, choices] = await Promise.all([
    experienceId === null ? null : readExperienceForOps(caller, experienceId),
    readExperienceChoices(caller),
  ]);
  if (view === null) notFound();
  const { notice, photoRefusal } = experiencePageNotice(query.notice);

  return (
    <PageHeading title={view.content.name}>
      <p>
        <Link href={experiencesPath}>Back to the experiences</Link>
        {' · '}
        <Link href={availabilityPath(view.id)}>Weekly slots and seats</Link>
      </p>
      <ActionNotice notice={notice} />
      <ExperiencePauseForm
        experienceId={view.id}
        status={view.status}
        pause={pauseExperienceAction}
        unpause={unpauseExperienceAction}
      />
      <ExperienceEditView
        view={view}
        choices={choices}
        problems={parseProblemFields(query.fields, experienceFormFields)}
        photoProblems={parseProblemFields(query.fields, photoFormFields)}
        photoRefusal={photoRefusal}
        save={updateExperienceAction}
        addPhoto={addExperiencePhotoAction}
      />
    </PageHeading>
  );
}
