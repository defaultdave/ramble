'use server';

import { EntityIdSchema } from '@/lib/catalog';
import {
  privateRequestNotice,
  privateRequestSchema,
  privateSessionFieldErrors,
  readPrivateSessionValues,
  type PrivateSessionFormState,
} from '@/lib/privateSession';
import { venueToday } from '@/lib/venue';
import { insertPrivateRequest } from '@/server/db/privateRequests';
import { runGuardedForm } from '@/server/guardedForm';

const experienceIdField = 'experienceId';

/**
 * The private session request form (PRD-35), run by `runGuardedForm`. Nothing here logs what the
 * guest typed.
 */
export async function requestPrivateSession(
  _previous: PrivateSessionFormState,
  formData: FormData,
): Promise<PrivateSessionFormState> {
  const values = readPrivateSessionValues((field) => formData.get(field));
  return runGuardedForm({
    formName: 'private-session',
    dedupePrefix: 'private-request',
    failureLog: 'private session request failed',
    formData,
    values,
    parse: (now) => {
      const experienceId = EntityIdSchema.safeParse(
        formData.get(experienceIdField),
      );
      if (!experienceId.success) {
        return { ok: false, state: { status: 'failed', values } };
      }
      const parsed = privateRequestSchema(venueToday(now)).safeParse({
        ...values,
        budgetMinor: values.budget,
      });
      return parsed.success
        ? {
            ok: true,
            data: {
              experienceId: experienceId.data.toLowerCase(),
              request: parsed.data,
            },
          }
        : {
            ok: false,
            state: {
              status: 'invalid',
              values,
              errors: privateSessionFieldErrors(parsed.error),
            },
          };
    },
    insert: (tx, { experienceId, request }) =>
      insertPrivateRequest(tx, experienceId, request),
    notice: ({ request }, stored) => privateRequestNotice(request, stored),
  });
}
