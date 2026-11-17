import 'server-only';
import { headers } from 'next/headers';
import { clientAddress } from '@/lib/clientAddress';
import { opsNoticeKind, type OpsNoticeData } from '@/lib/email/opsNotice';
import { errorKind } from '@/lib/errorKind';
import type { GuardedFormState } from '@/lib/formFields';
import { FORM_TOKEN_FIELD, HONEYPOT_FIELD } from '@/lib/formGuard';
import { db, type Transaction } from '@/server/db/client';
import { checkFormGuard } from '@/server/formGuard';
import { enqueue } from '@/server/jobs/enqueue';
import { logger } from '@/server/monitoring/logger';
import { systemClock } from '@/server/ports/clock';
import { consumeRateLimit } from '@/server/ports/rate-limit';

export type GuardedFormSpec<
  Values,
  Errors,
  Parsed,
  Stored extends { id: string },
> = {
  /** The form name in the rate-limit subject: the `forms` counter is per address and form. */
  formName: string;
  /** Names the request in the dedupe key, as `<prefix>:<stored id>`. */
  dedupePrefix: string;
  /** The log line when the write fails; the log holds the error kind and nothing the guest typed. */
  failureLog: string;
  formData: FormData;
  /** What the guest typed, kept as text so a refused form comes back as it was sent. */
  values: Values;
  /** The parsed form, or the reply that refuses it: `invalid` with field errors, or `failed`. */
  parse: (now: Date) =>
    | { ok: true; data: Parsed }
    | {
        ok: false;
        state: Extract<
          GuardedFormState<Values, Errors>,
          { status: 'invalid' | 'failed' }
        >;
      };
  insert: (tx: Transaction, data: Parsed) => Promise<Stored>;
  notice: (data: Parsed, stored: Stored) => OpsNoticeData;
};

/**
 * Runs a public form that writes one request and one notice to ops. A refused guard (a filled
 * honeypot, a forged or too-fast token) gets the reply a success gets and writes nothing, so a bot
 * learns nothing; only a stale form is asked to reload. A form that fails validation costs no
 * rate-limit try. The request and the notice are written in one transaction, so one never exists
 * without the other. A failure after validation answers `failed`, never `sent`.
 */
export async function runGuardedForm<
  Values,
  Errors,
  Parsed,
  Stored extends { id: string },
>(
  spec: GuardedFormSpec<Values, Errors, Parsed, Stored>,
): Promise<GuardedFormState<Values, Errors>> {
  const { formData, values } = spec;
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

  const parsed = spec.parse(now);
  if (!parsed.ok) return parsed.state;

  try {
    const decision = await consumeRateLimit(
      'forms',
      `${clientAddress((await headers()).get('x-forwarded-for'))}:${spec.formName}`,
    );
    if (!decision.allowed) return { status: 'rate_limited', values };

    await db.transaction(async (tx) => {
      const stored = await spec.insert(tx, parsed.data);
      await enqueue(tx, {
        kind: opsNoticeKind,
        payload: spec.notice(parsed.data, stored),
        dedupeKey: `${spec.dedupePrefix}:${stored.id}`,
      });
    });
    return { status: 'sent' };
  } catch (error) {
    logger.error(spec.failureLog, { errorKind: errorKind(error) });
    return { status: 'failed', values };
  }
}
