'use server';

import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { errorKind } from '@/lib/errorKind';
import { hostAccessFor } from '@/lib/hostAccess';
import {
  hostSessionFormValues,
  hostSessionInvalid,
  hostSessionProblem,
  hostSessionsPath,
  publishWeekMessage,
  type HostSessionFormState,
  type HostSessionProblem,
} from '@/lib/hostSessions';
import {
  AddOneOffSessionInputSchema,
  CancelSessionInputSchema,
  IsoDateSchema,
  UpdateSessionAllocationInputSchema,
  UpdateSessionPriceInputSchema,
  UpdateSessionTimeInputSchema,
} from '@/lib/sessions';
import { ForbiddenError, getCaller, type Caller } from '@/server/auth/caller';
import {
  addOneOffSession,
  cancelUnbookedSession,
  publishWeek,
  updateSessionAllocation,
  updateSessionPrice,
  updateSessionTime,
} from '@/server/db/sessions';
import { logger } from '@/server/monitoring/logger';
import { systemClock } from '@/server/ports/clock';

type Outcome =
  { ok: true; message: string } | { ok: false; reason: HostSessionProblem };

/**
 * Runs one host edit for the signed-in caller. The caller is the person the session cookie names,
 * never a field of the form; every db function checks that the session or host is theirs, so a
 * session id posted from another host is refused, and a refusal is answered as a refusal. A form
 * posts only what the schema accepts, and a failure on our side logs its kind, never what was typed.
 * A saved edit refreshes the week page.
 */
async function run<Schema extends z.ZodType>(
  formData: FormData,
  schema: Schema,
  values: (get: (field: string) => unknown) => unknown,
  action: string,
  apply: (caller: Caller, input: z.output<Schema>) => Promise<Outcome>,
): Promise<HostSessionFormState> {
  const parsed = schema.safeParse(values((field) => formData.get(field)));
  if (!parsed.success) return hostSessionInvalid(parsed.error);
  try {
    const caller = await getCaller();
    const outcome = await apply(caller, parsed.data);
    if (!outcome.ok) return hostSessionProblem(outcome.reason);
    revalidatePath(hostSessionsPath);
    return { status: 'done', message: outcome.message };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return hostSessionProblem('session_not_found');
    }
    logger.error('host session edit failed', {
      action,
      errorKind: errorKind(error),
    });
    return { status: 'failed' };
  }
}

const ok = (message: string): Outcome => ({ ok: true, message });

export async function updateSessionCapacityAction(
  _previous: HostSessionFormState,
  formData: FormData,
): Promise<HostSessionFormState> {
  return run(
    formData,
    UpdateSessionAllocationInputSchema,
    hostSessionFormValues.capacity,
    'capacity',
    async (caller, input) => {
      const result = await updateSessionAllocation(
        caller,
        input,
        systemClock.now(),
      );
      return result.ok ? ok('Capacity saved.') : result;
    },
  );
}

export async function updateSessionTimeAction(
  _previous: HostSessionFormState,
  formData: FormData,
): Promise<HostSessionFormState> {
  return run(
    formData,
    UpdateSessionTimeInputSchema,
    hostSessionFormValues.time,
    'time',
    async (caller, input) => {
      const result = await updateSessionTime(caller, input, systemClock.now());
      return result.ok ? ok('Time saved.') : result;
    },
  );
}

export async function updateSessionPriceAction(
  _previous: HostSessionFormState,
  formData: FormData,
): Promise<HostSessionFormState> {
  return run(
    formData,
    UpdateSessionPriceInputSchema,
    hostSessionFormValues.price,
    'price',
    async (caller, input) => {
      const result = await updateSessionPrice(caller, input, systemClock.now());
      return result.ok
        ? ok('Price saved. It applies to new bookings only.')
        : result;
    },
  );
}

export async function cancelSessionAction(
  _previous: HostSessionFormState,
  formData: FormData,
): Promise<HostSessionFormState> {
  return run(
    formData,
    CancelSessionInputSchema,
    hostSessionFormValues.cancel,
    'cancel',
    async (caller, input) => {
      const result = await cancelUnbookedSession(
        caller,
        input,
        systemClock.now(),
      );
      return result.ok ? ok('Session cancelled.') : result;
    },
  );
}

export async function addOneOffSessionAction(
  _previous: HostSessionFormState,
  formData: FormData,
): Promise<HostSessionFormState> {
  return run(
    formData,
    AddOneOffSessionInputSchema,
    hostSessionFormValues.oneOff,
    'one-off',
    async (caller, input) => {
      const result = await addOneOffSession(caller, input, systemClock.now());
      return result.ok ? ok('Session added.') : result;
    },
  );
}

/** Publishes the week the form names for the host the caller owns; the host is read from the caller's grant. */
export async function publishWeekAction(
  _previous: HostSessionFormState,
  formData: FormData,
): Promise<HostSessionFormState> {
  const week = IsoDateSchema.safeParse(
    hostSessionFormValues.week((field) => formData.get(field)).weekStart,
  );
  if (!week.success) return hostSessionInvalid(week.error);
  try {
    const caller = await getCaller();
    const access = hostAccessFor(caller);
    if (access.kind !== 'owner') return hostSessionProblem('session_not_found');
    const result = await publishWeek(
      caller,
      access.hostId,
      week.data,
      systemClock.now(),
    );
    if (!result.ok) return hostSessionProblem(result.reason);
    revalidatePath(hostSessionsPath);
    return { status: 'done', message: publishWeekMessage(result) };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return hostSessionProblem('session_not_found');
    }
    logger.error('host session edit failed', {
      action: 'publish',
      errorKind: errorKind(error),
    });
    return { status: 'failed' };
  }
}
