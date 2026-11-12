import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import { AvailabilityView } from '@/components/Availability';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import {
  availabilityFormFields,
  availabilityNoticeCodes,
  availabilityNotices,
  availabilityPath,
  buildAvailabilityView,
} from '@/lib/availability';
import { experiencePath } from '@/lib/experienceEditor';
import {
  noticeText,
  parseIdField,
  parseNotice,
  parseProblemFields,
} from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import {
  addWeeklySlotsAction,
  updateSlotSeatsAction,
} from '@/server/actions/availability';
import { readAvailability } from '@/server/db/availability';
import { readOpsCaller } from '@/server/opsCaller';
import { systemClock } from '@/server/ports/clock';

export const metadata: Metadata = { title: 'Availability' };

export default async function AvailabilityPage({
  params,
  searchParams,
}: PageProps<'/ops/experiences/[id]/availability'>) {
  const [{ id }, query, caller] = await Promise.all([
    params,
    searchParams,
    readOpsCaller(),
  ]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={availabilityPath(id)} />;
  }

  const experienceId = parseIdField(id);
  const data =
    experienceId === null
      ? null
      : await readAvailability(caller, experienceId, systemClock.now());
  if (data === null) notFound();
  const view = buildAvailabilityView(data);
  const notice = noticeText(
    availabilityNotices,
    parseNotice(query.notice, availabilityNoticeCodes),
  );

  return (
    <PageHeading title={`Availability: ${data.experienceName}`}>
      <p>
        <Link href={experiencePath(data.experienceId)}>
          Back to the experience
        </Link>
      </p>
      <ActionNotice notice={notice} />
      <AvailabilityView
        experienceId={data.experienceId}
        timeZone={view.timeZone}
        slots={view.slots}
        problems={parseProblemFields(query.fields, availabilityFormFields)}
        addSlots={addWeeklySlotsAction}
        saveSeats={updateSlotSeatsAction}
      />
    </PageHeading>
  );
}
