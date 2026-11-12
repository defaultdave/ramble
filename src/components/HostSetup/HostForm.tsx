import { Button } from '@/components/Button';
import { CheckField } from '@/components/CheckField';
import { EmailField } from '@/components/EmailField';
import { Input } from '@/components/Input';
import {
  agreementTickLabel,
  defaultHostTimeZone,
  hostFieldProblems,
  hostLimits,
  type HostFormField,
  type HostInput,
} from '@/lib/hostSetup';
import { errorProps } from '@/lib/opsForm';
import { maxTimeZoneLength } from '@/lib/sessions';
import {
  HostDescriptionField,
  HostNameField,
  HostNoticeEmailField,
} from './HostProfileFields';
import styles from './HostSetup.module.css';

type FormAction = (formData: FormData) => void | Promise<void>;

export type HostFormProps = {
  action: FormAction;
  /** Prefilled on edit; the create form starts empty with New York as the zone. */
  values?: (HostInput & { id: string }) | undefined;
  /** The fields the last try needed another look at, which the page read from the address. */
  problems?: readonly HostFormField[];
  /** On the create form: the agreement version the box accepts, or null when none is published. */
  agreement?: { id: string; version: number; title: string } | null | undefined;
};

/** The host record form. With no values it creates a host and its owner; with values it edits the host. */
export function HostForm({
  action,
  values,
  problems = [],
  agreement,
}: HostFormProps) {
  const creating = values === undefined;
  const errorFor = (field: HostFormField) =>
    errorProps(problems, hostFieldProblems, field);
  return (
    <form action={action} className={styles.form} noValidate>
      {values ? <input type="hidden" name="hostId" value={values.id} /> : null}
      <HostNameField defaultValue={values?.name} problems={problems} />
      <Input
        name="slug"
        label="Address name"
        hint={
          creating
            ? 'Used in the host page address. Left empty, it is made from the name.'
            : 'Used in the host page address. The old address keeps working.'
        }
        defaultValue={values?.slug}
        maxLength={hostLimits.slug}
        autoComplete="off"
        optional={creating}
        required={!creating}
        {...errorFor('slug')}
      />
      <HostDescriptionField
        defaultValue={values?.description}
        problems={problems}
        label="Description"
        hint="Shown on the host page."
      />
      <Input
        name="timeZone"
        label="Time zone"
        hint="Session times are read in this zone."
        defaultValue={values?.timeZone ?? defaultHostTimeZone}
        maxLength={maxTimeZoneLength}
        autoComplete="off"
        required
        {...errorFor('timeZone')}
      />
      <HostNoticeEmailField
        defaultValue={values?.notificationEmail}
        problems={problems}
      />
      {creating ? (
        <>
          <EmailField
            name="ownerEmail"
            label="Owner email"
            hint="The owner gets a sign-in link at this address. No password."
            {...errorFor('ownerEmail')}
          />
          {problems.includes('acceptLegalDocumentId') ? (
            <p role="alert" className={styles.muted}>
              {hostFieldProblems.acceptLegalDocumentId}
            </p>
          ) : null}
          {agreement ? (
            <CheckField
              name="acceptLegalDocumentId"
              value={agreement.id}
              label={agreementTickLabel(agreement)}
            />
          ) : (
            <p className={styles.muted}>
              No host agreement is published yet, so acceptance cannot be
              recorded now.
            </p>
          )}
        </>
      ) : null}
      <Button type="submit" size="lg">
        {creating ? 'Create host and email owner' : 'Save host'}
      </Button>
    </form>
  );
}
