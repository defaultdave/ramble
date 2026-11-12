import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionNotice } from '@/components/ActionNotice';
import { ExperienceForm } from '@/components/ExperienceEditor';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import {
  experienceFormFields,
  experienceNoticeCodes,
  experienceNotices,
  experiencesPath,
  newExperiencePath,
  newExperienceValues,
} from '@/lib/experienceEditor';
import { noticeText, parseNotice, parseProblemFields } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { createExperienceAction } from '@/server/actions/experiences';
import { readExperienceChoices } from '@/server/db/experienceEditor';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Add an experience' };

export default async function NewExperiencePage({
  searchParams,
}: PageProps<'/ops/experiences/new'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={newExperiencePath} />;
  }

  const choices = await readExperienceChoices(caller);
  return (
    <PageHeading title="Add an experience">
      <p>
        <Link href={experiencesPath}>Back to the experiences</Link>
      </p>
      <p>
        It starts as a draft. The host does not see it until it is reviewed.
      </p>
      <ActionNotice
        notice={noticeText(
          experienceNotices,
          parseNotice(query.notice, experienceNoticeCodes),
        )}
      />
      <ExperienceForm
        action={createExperienceAction}
        values={newExperienceValues({
          categoryId: '',
          neighborhoodId: '',
          cancellationTierId: choices.defaultCancellationTierId,
        })}
        choices={choices}
        problems={parseProblemFields(query.fields, experienceFormFields)}
      />
    </PageHeading>
  );
}
