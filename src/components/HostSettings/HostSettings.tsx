import Link from 'next/link';
import { ActionNotice } from '@/components/ActionNotice';
import { Button } from '@/components/Button';
import {
  HostDescriptionField,
  HostNameField,
  HostNoticeEmailField,
} from '@/components/HostSetup';
import { PageHeading } from '@/components/PageHeading';
import { hostDashboardPath } from '@/lib/hostDashboard';
import type { HostSettingsField, HostSettingsInput } from '@/lib/hostSetup';
import type { NoticeText } from '@/lib/opsForm';
import styles from './HostSettings.module.css';

export const hostSettingsTitle = 'Host settings';

export type HostSettingsProps = {
  values: HostSettingsInput;
  action: (formData: FormData) => void | Promise<void>;
  notice: NoticeText | null;
  /** The fields the last try needed another look at, which the page read from the address. */
  problems: readonly HostSettingsField[];
};

/** The host's own name, about text and booking notice address, as a plain form that works without script. The address name and time zone stay with Ramble. */
export function HostSettings({
  values,
  action,
  notice,
  problems,
}: HostSettingsProps) {
  return (
    <>
      <PageHeading title={hostSettingsTitle}>
        <p>
          <Link href={hostDashboardPath}>Back to the dashboard</Link>
        </p>
        <ActionNotice notice={notice} />
      </PageHeading>
      <form action={action} className={styles.form} noValidate>
        <HostNameField
          defaultValue={values.name}
          problems={problems}
          hint="Shown to guests on your page and on each experience."
        />
        <HostDescriptionField
          defaultValue={values.description}
          problems={problems}
          label="About"
          hint="Shown on your host page."
        />
        <HostNoticeEmailField
          defaultValue={values.notificationEmail}
          problems={problems}
        />
        <Button type="submit" size="lg">
          Save settings
        </Button>
      </form>
    </>
  );
}
