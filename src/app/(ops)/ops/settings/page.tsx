import type { Metadata } from 'next';
import { ActionNotice } from '@/components/ActionNotice';
import { OpsSettings } from '@/components/OpsSettings';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { pausedStatus } from '@/lib/experiencePause';
import { noticeText, parseNotice, parseProblemFields } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import {
  cancellationTierRows,
  pausedExperienceSummary,
  settingsFormFields,
  settingsFormValues,
  settingsNoticeCodes,
  settingsNotices,
  settingsPath,
} from '@/lib/opsSettings';
import { updateSettingsAction } from '@/server/actions/settings';
import { readExperiencesForOps } from '@/server/db/experienceEditor';
import { listCancellationTiers } from '@/server/db/policies';
import { readSettings } from '@/server/db/settings';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage({
  searchParams,
}: PageProps<'/ops/settings'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={settingsPath} />;
  }

  const [current, paused, tiers] = await Promise.all([
    readSettings(caller),
    readExperiencesForOps(
      caller,
      { status: pausedStatus, hostId: null, categoryId: null },
      null,
    ),
    listCancellationTiers(),
  ]);
  return (
    <>
      <PageHeading title="Settings">
        <ActionNotice
          notice={noticeText(
            settingsNotices,
            parseNotice(query.notice, settingsNoticeCodes),
          )}
        />
      </PageHeading>
      <OpsSettings
        values={settingsFormValues(current)}
        action={updateSettingsAction}
        problems={parseProblemFields(query.fields, settingsFormFields)}
        paused={pausedExperienceSummary(paused)}
        tiers={cancellationTierRows(tiers)}
      />
    </>
  );
}
