'use server';

import { headers } from 'next/headers';
import { clientAddress } from '@/lib/clientAddress';
import { opsNoticeKind, type OpsNoticeData } from '@/lib/email/opsNotice';
import { errorKind } from '@/lib/errorKind';
import { FORM_TOKEN_FIELD, HONEYPOT_FIELD } from '@/lib/formGuard';
import {
  SupportRequestSchema,
  readSupportValues,
  supportFieldErrors,
  supportTopicLabels,
  type SupportFormState,
  type SupportRequestInput,
} from '@/lib/support';
import { db } from '@/server/db/client';
import { insertSupportRequest } from '@/server/db/support';
import { checkFormGuard } from '@/server/formGuard';
import { enqueue } from '@/server/jobs/enqueue';
import { logger } from '@/server/monitoring/logger';
import { systemClock } from '@/server/ports/clock';
import { consumeRateLimit } from '@/server/ports/rate-limit';

/** The form name in the rate-limit subject: the `forms` counter is per address and form. */
const formName = 'contact';

function opsNotice(
  request: SupportRequestInput,
  stored: { id: string; createdAt: Date },
): OpsNoticeData {
  return {
    subject: `Contact form: ${supportTopicLabels[request.topic]}`,
    fields: [
      { label: 'Name', value: request.name },
      { label: 'Email', value: request.email },
      { label: 'Topic', value: supportTopicLabels[request.topic] },
      { label: 'Message', value: request.message },
      { label: 'Request ID', value: stored.id },
      { label: 'Received', value: stored.createdAt.toISOString() },
    ],
  };
}

/**
 * The contact form (PRD-54). A refused guard (a filled honeypot, a forged or too-fast token) gets
 * the reply a success gets and writes nothing, so a bot learns nothing; only a stale form is asked
 * to reload. The request and the notice to ops are written in one transaction, so one never
 * exists without the other. Nothing here logs the name, the address, or the message.
 */
export async function submitSupportRequest(
  _previous: SupportFormState,
  formData: FormData,
): Promise<SupportFormState> {
  const values = readSupportValues((field) => formData.get(field));

  const guard = checkFormGuard(
    {
      [HONEYPOT_FIELD]: formData.get(HONEYPOT_FIELD) ?? undefined,
      [FORM_TOKEN_FIELD]: formData.get(FORM_TOKEN_FIELD),
    },
    systemClock.now(),
  );
  if (!guard.ok) {
    return guard.reason === 'expired'
      ? { status: 'expired', values }
      : { status: 'sent' };
  }

  const parsed = SupportRequestSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'invalid',
      values,
      errors: supportFieldErrors(parsed.error),
    };
  }

  try {
    const decision = await consumeRateLimit(
      'forms',
      `${clientAddress((await headers()).get('x-forwarded-for'))}:${formName}`,
    );
    if (!decision.allowed) return { status: 'rate_limited', values };

    await db.transaction(async (tx) => {
      const stored = await insertSupportRequest(tx, parsed.data);
      await enqueue(tx, {
        kind: opsNoticeKind,
        payload: opsNotice(parsed.data, stored),
        dedupeKey: `support-request:${stored.id}`,
      });
    });
    return { status: 'sent' };
  } catch (error) {
    logger.error('support request failed', { errorKind: errorKind(error) });
    return { status: 'failed', values };
  }
}
