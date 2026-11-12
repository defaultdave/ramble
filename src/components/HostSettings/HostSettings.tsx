import Link from 'next/link';
import { ActionNotice } from '@/components/ActionNotice';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { PageHeading } from '@/components/PageHeading';
import { Textarea } from '@/components/Textarea';
import { maxEmailAddressLength } from '@/lib/email/address';
import { hostDashboardPath } from '@/lib/hostDashboard';
import {
  hostFieldProblems,
  hostLimits,
  type HostSettingsField,
  type HostSettingsInput,
} from '@/lib/hostSetup';
import { errorProps, type NoticeText } from '@/lib/opsForm';
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
  const errorFor = (field: HostSettingsField) =>
    errorProps(problems, hostFieldProblems, field);
  return (
    <>
      <PageHeading title={hostSettingsTitle}>
        <p>
          <Link href={hostDashboardPath}>Back to the dashboard</Link>
        </p>
        <ActionNotice notice={notice} />
      </PageHeading>
      <form action={action} className={styles.form} noValidate>
        <Input
          name="name"
          label="Host name"
          hint="Shown to guests on your page and on each experience."
          defaultValue={values.name}
          maxLength={hostLimits.name}
          autoComplete="off"
          required
          {...errorFor('name')}
        />
        <Textarea
          name="description"
          label="About"
          hint="Shown on your host page."
          defaultValue={values.description ?? undefined}
          maxLength={hostLimits.description}
          optional
          {...errorFor('description')}
        />
        <Input
          name="notificationEmail"
          type="email"
          label="Booking notice address"
          hint="Where booking and cancellation emails go. Not shown to guests."
          defaultValue={values.notificationEmail ?? undefined}
          maxLength={maxEmailAddressLength}
          autoComplete="off"
          optional
          {...errorFor('notificationEmail')}
        />
        <Button type="submit" size="lg">
          Save settings
        </Button>
      </form>
    </>
  );
}
