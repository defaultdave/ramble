import { Input, type InputProps } from '@/components/Input';
import { maxEmailAddressLength } from '@/lib/email/address';

export type EmailFieldProps = Pick<
  InputProps,
  'name' | 'label' | 'hint' | 'errorText'
>;

/** A required email address field: one type, one length limit, and no autofill of someone else's address. */
export function EmailField(props: EmailFieldProps) {
  return (
    <Input
      {...props}
      type="email"
      maxLength={maxEmailAddressLength}
      autoComplete="off"
      required
    />
  );
}
