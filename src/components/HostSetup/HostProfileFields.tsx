import { Input } from '@/components/Input';
import { Textarea } from '@/components/Textarea';
import { maxEmailAddressLength } from '@/lib/email/address';
import {
  hostFieldProblems,
  hostLimits,
  type HostFormField,
} from '@/lib/hostSetup';
import { errorProps } from '@/lib/opsForm';

// The host fields the ops host form and the host's own settings form both ask for, with the same
// limits and refusal texts. Each form brings its own label and hint, and its own place for them.

type FieldProps<Value = string | null | undefined> = {
  defaultValue: Value;
  problems: readonly HostFormField[];
};

const errorFor = (problems: readonly HostFormField[], field: HostFormField) =>
  errorProps(problems, hostFieldProblems, field);

export function HostNameField({
  defaultValue,
  problems,
  hint,
}: FieldProps & { hint?: string }) {
  return (
    <Input
      name="name"
      label="Host name"
      {...(hint === undefined ? {} : { hint })}
      defaultValue={defaultValue ?? undefined}
      maxLength={hostLimits.name}
      autoComplete="off"
      required
      {...errorFor(problems, 'name')}
    />
  );
}

export function HostDescriptionField({
  defaultValue,
  problems,
  label,
  hint,
}: FieldProps & { label: string; hint: string }) {
  return (
    <Textarea
      name="description"
      label={label}
      hint={hint}
      defaultValue={defaultValue ?? undefined}
      maxLength={hostLimits.description}
      optional
      {...errorFor(problems, 'description')}
    />
  );
}

export function HostNoticeEmailField({ defaultValue, problems }: FieldProps) {
  return (
    <Input
      name="notificationEmail"
      type="email"
      label="Booking notice address"
      hint="Where booking and cancellation emails go. Not shown to guests."
      defaultValue={defaultValue ?? undefined}
      maxLength={maxEmailAddressLength}
      autoComplete="off"
      optional
      {...errorFor(problems, 'notificationEmail')}
    />
  );
}
