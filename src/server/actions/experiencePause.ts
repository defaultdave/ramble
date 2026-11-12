'use server';

import { redirect } from 'next/navigation';
import { experiencePath, experiencesPath } from '@/lib/experienceEditor';
import type { PauseKind } from '@/lib/experiencePause';
import { hostPath, hostsPath } from '@/lib/hostSetup';
import { noticeHref } from '@/lib/opsForm';
import {
  setExperiencePaused,
  setHostSuspended,
} from '@/server/db/experiencePause';
import { idOrLeave, opsCallerOrLeave } from '@/server/opsAccess';

/** Pauses or unpauses one experience, then returns to its page with the outcome. */
async function moveExperience(
  formData: FormData,
  kind: PauseKind,
): Promise<never> {
  const caller = await opsCallerOrLeave(experiencesPath);
  const experienceId = idOrLeave(formData, 'experienceId', experiencesPath);
  const result = await setExperiencePaused(caller, experienceId, kind);
  if (result.status === 'not_found') redirect(experiencesPath);
  redirect(noticeHref(experiencePath(experienceId), result.status));
}

/** Suspends or unsuspends one host, then returns to its page with the outcome. */
async function moveHost(formData: FormData, kind: PauseKind): Promise<never> {
  const caller = await opsCallerOrLeave(hostsPath);
  const hostId = idOrLeave(formData, 'hostId', hostsPath);
  const result = await setHostSuspended(caller, hostId, kind);
  if (result.status === 'not_found') redirect(hostsPath);
  redirect(noticeHref(hostPath(hostId), result.status));
}

export async function pauseExperienceAction(formData: FormData): Promise<void> {
  await moveExperience(formData, 'pause');
}

export async function unpauseExperienceAction(
  formData: FormData,
): Promise<void> {
  await moveExperience(formData, 'unpause');
}

export async function suspendHostAction(formData: FormData): Promise<void> {
  await moveHost(formData, 'pause');
}

export async function unsuspendHostAction(formData: FormData): Promise<void> {
  await moveHost(formData, 'unpause');
}
