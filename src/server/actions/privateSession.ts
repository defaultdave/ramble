'use server';

import { headers } from 'next/headers';
import { EntityIdSchema } from '@/lib/catalog';
import { clientAddress } from '@/lib/clientAddress';
import { opsNoticeKind } from '@/lib/email/opsNotice';
import { errorKind } from '@/lib/errorKind';
import { FORM_TOKEN_FIELD, HONEYPOT_FIELD } from '@/lib/formGuard';
import {
  privateRequestNotice,
  privateRequestSchema,
  privateSessionFieldErrors,
  readPrivateSessionValues,
  type PrivateSessionFormState,
} from '@/lib/privateSession';
import { venueToday } from '@/lib/venue';
import { db } from '@/server/db/client';
import { insertPrivateRequest } from '@/server/db/privateRequests';
import { checkFormGuard } from '@/server/formGuard';
import { enqueue } from '@/server/jobs/enqueue';
import { logger } from '@/server/monitoring/logger';
import { systemClock } from '@/server/ports/clock';
import { consumeRateLimit } from '@/server/ports/rate-limit';

/** The form name in the rate-limit subject: the `forms` counter is per address and form. */
const formName = 'private-session';

const experienceIdField = 'experienceId';

/**
 * The private session request form (PRD-35). A refused guard (a filled honeypot, a forged or
 * too-fast token) gets the reply a success gets and writes nothing, so a bot learns nothing; only a
 * stale form is asked to reload. The request and the notice to ops are written in one transaction,
 * so one never exists without the other. Nothing here logs what the guest typed.
 */
export async function requestPrivateSession(
  _previous: PrivateSessionFormState,
  formData: FormData,
): Promise<PrivateSessionFormState> {
  const values = readPrivateSessionValues((field) => formData.get(field));
  const now = systemClock.now();

  const guard = checkFormGuard(
    {
      [HONEYPOT_FIELD]: formData.get(HONEYPOT_FIELD) ?? undefined,
      [FORM_TOKEN_FIELD]: formData.get(FORM_TOKEN_FIELD),
    },
    now,
  );
  if (!guard.ok) {
    return guard.reason === 'expired'
      ? { status: 'expired', values }
      : { status: 'sent' };
  }

  const experienceId = EntityIdSchema.safeParse(
    formData.get(experienceIdField),
  );
  if (!experienceId.success) return { status: 'failed', values };

  const parsed = privateRequestSchema(venueToday(now)).safeParse({
    ...values,
    budgetMinor: values.budget,
  });
  if (!parsed.success) {
    return {
      status: 'invalid',
      values,
      errors: privateSessionFieldErrors(parsed.error),
    };
  }

  try {
    const decision = await consumeRateLimit(
      'forms',
      `${clientAddress((await headers()).get('x-forwarded-for'))}:${formName}`,
    );
    if (!decision.allowed) return { status: 'rate_limited', values };

    await db.transaction(async (tx) => {
      const stored = await insertPrivateRequest(
        tx,
        experienceId.data.toLowerCase(),
        parsed.data,
      );
      await enqueue(tx, {
        kind: opsNoticeKind,
        payload: privateRequestNotice(parsed.data, stored),
        dedupeKey: `private-request:${stored.id}`,
      });
    });
    return { status: 'sent' };
  } catch (error) {
    logger.error('private session request failed', {
      errorKind: errorKind(error),
    });
    return { status: 'failed', values };
  }
}
