import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import { ExperienceEditView } from '@/components/ExperienceEditor';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import {
  experienceFormFields,
  experienceNoticeCodes,
  experienceNotices,
  experiencePath,
  experiencesPath,
} from '@/lib/experienceEditor';
import {
  noticeText,
  parseIdField,
  parseNotice,
  parseProblemFields,
} from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import {
  photoFormFields,
  photoNoticeCodes,
  photoNotices,
  photoRefusalOf,
} from '@/lib/photoForm';
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
  const photoNotice = parseNotice(query.notice, photoNoticeCodes);

  return (
    <PageHeading title={view.content.name}>
      <p>
        <Link href={experiencesPath}>Back to the experiences</Link>
      </p>
      <ActionNotice
        notice={
          noticeText(
            experienceNotices,
            parseNotice(query.notice, experienceNoticeCodes),
          ) ?? noticeText(photoNotices, photoNotice)
        }
      />
      <ExperienceEditView
        view={view}
        choices={choices}
        problems={parseProblemFields(query.fields, experienceFormFields)}
        photoProblems={parseProblemFields(query.fields, photoFormFields)}
        photoRefusal={photoRefusalOf(photoNotice)}
        save={updateExperienceAction}
        addPhoto={addExperiencePhotoAction}
      />
    </PageHeading>
  );
}
