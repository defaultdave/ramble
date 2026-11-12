import 'server-only';
import { redirect } from 'next/navigation';
import { experiencesPath } from '@/lib/experienceEditor';
import { parseIdField } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import type { Caller } from '@/server/auth/caller';
import { readOpsCaller } from './opsCaller';

/**
 * The ops caller for a Server Action. Anyone without the ops role is sent to `leaveTo`, the ops
 * list page, which shows them the refusal; nothing about the request is said. `redirect` works by
 * throwing, so an action calling this is not wrapped in a try.
 */
export async function opsCallerOrLeave(leaveTo: string): Promise<Caller> {
  const caller = await readOpsCaller();
  if (!holdsOpsRole(caller.roles)) redirect(leaveTo);
  return caller;
}

/** The experience a posted form names, or the experiences list for a form that names none. */
export function experienceIdOrLeave(formData: FormData): string {
  const experienceId = parseIdField(formData.get('experienceId'));
  if (experienceId === null) redirect(experiencesPath);
  return experienceId;
}
