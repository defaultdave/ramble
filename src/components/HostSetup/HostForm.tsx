import { Button } from '@/components/Button';
import { CheckField } from '@/components/CheckField';
import { Input } from '@/components/Input';
import { Textarea } from '@/components/Textarea';
import {
  agreementTickLabel,
  defaultHostTimeZone,
  hostFieldProblems,
  hostLimits,
  type HostFormField,
  type HostInput,
} from '@/lib/hostSetup';
import { maxEmailAddressLength } from '@/lib/email/address';
import { maxTimeZoneLength } from '@/lib/sessions';
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
    problems.includes(field) ? { errorText: hostFieldProblems[field] } : {};
  return (
    <form action={action} className={styles.form} noValidate>
      {values ? <input type="hidden" name="hostId" value={values.id} /> : null}
      <Input
        name="name"
        label="Host name"
        defaultValue={values?.name}
        maxLength={hostLimits.name}
        autoComplete="off"
        required
        {...errorFor('name')}
      />
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
      <Textarea
        name="description"
        label="Description"
        hint="Shown on the host page."
        defaultValue={values?.description ?? undefined}
        maxLength={hostLimits.description}
        optional
        {...errorFor('description')}
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
      <Input
        name="notificationEmail"
        type="email"
        label="Booking notice address"
        hint="Where booking and cancellation emails go. Not shown to guests."
        defaultValue={values?.notificationEmail ?? undefined}
        maxLength={maxEmailAddressLength}
        autoComplete="off"
        optional
        {...errorFor('notificationEmail')}
      />
      {creating ? (
        <>
          <Input
            name="ownerEmail"
            type="email"
            label="Owner email"
            hint="The owner gets a sign-in link at this address. No password."
            maxLength={maxEmailAddressLength}
            autoComplete="off"
            required
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
