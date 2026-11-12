import 'server-only';
import { redirect } from 'next/navigation';
import { parseIdField } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import type { Caller } from '@/server/auth/caller';
import { readOpsCaller } from './opsCaller';

/**
 * What `find` returns for a Server Action, or a redirect to `leaveTo` when it returns null: the
 * caller of the area, or nothing for anyone who does not belong there. `redirect` works by
 * throwing, so an action calling this is not wrapped in a try.
 */
export async function callerOrLeave<T>(
  find: () => Promise<T | null>,
  leaveTo: string,
): Promise<T> {
  const found = await find();
  if (found === null) redirect(leaveTo);
  return found;
}

/**
 * The ops caller for a Server Action. Anyone without the ops role is sent to `leaveTo`, the ops
 * list page, which shows them the refusal; nothing about the request is said.
 */
export function opsCallerOrLeave(leaveTo: string): Promise<Caller> {
  return callerOrLeave(async () => {
    const caller = await readOpsCaller();
    return holdsOpsRole(caller.roles) ? caller : null;
  }, leaveTo);
}

/** The id a posted form carries in `field`, or the page `leaveTo` for a form that carries none. */
export function idOrLeave(
  formData: FormData,
  field: string,
  leaveTo: string,
): string {
  const id = parseIdField(formData.get(field));
  if (id === null) redirect(leaveTo);
  return id;
}
