'use server';

import {
  SupportRequestSchema,
  readSupportValues,
  supportFieldErrors,
  supportRequestNotice,
  type SupportFormState,
} from '@/lib/support';
import { insertSupportRequest } from '@/server/db/support';
import { runGuardedForm } from '@/server/guardedForm';

/**
 * The contact form (PRD-54), run by `runGuardedForm`. Nothing here logs the name, the address, or
 * the message.
 */
export async function submitSupportRequest(
  _previous: SupportFormState,
  formData: FormData,
): Promise<SupportFormState> {
  const values = readSupportValues((field) => formData.get(field));
  return runGuardedForm({
    formName: 'contact',
    dedupePrefix: 'support-request',
    failureLog: 'support request failed',
    formData,
    values,
    parse: () => {
      const parsed = SupportRequestSchema.safeParse(values);
      return parsed.success
        ? { ok: true, data: parsed.data }
        : {
            ok: false,
            state: {
              status: 'invalid',
              values,
              errors: supportFieldErrors(parsed.error),
            },
          };
    },
    insert: insertSupportRequest,
    notice: supportRequestNotice,
  });
}
