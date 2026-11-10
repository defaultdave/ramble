import { FORM_TOKEN_FIELD, HONEYPOT_FIELD } from '@/lib/formGuard';

export type FormGuardFieldsProps = {
  /** From `issueFormGuardToken`, called when the page renders. */
  token: string;
};

// TODO(U-043): second caller, the private session request form.
// `hidden` keeps the trap out of the layout and the accessibility tree, and out of autofill, so only
// a bot that fills every input in the markup trips it. No styles, so nothing for a bot to key on.
export function FormGuardFields({ token }: FormGuardFieldsProps) {
  return (
    <>
      <input type="hidden" name={FORM_TOKEN_FIELD} value={token} />
      <div hidden>
        <input
          type="text"
          name={HONEYPOT_FIELD}
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>
    </>
  );
}
