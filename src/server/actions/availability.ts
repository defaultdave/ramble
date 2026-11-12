'use server';

import { redirect } from 'next/navigation';
import {
  availabilityPath,
  parseAddSlotsForm,
  parseSeatsForm,
} from '@/lib/availability';
import { experiencesPath } from '@/lib/experienceEditor';
import { noticeHref } from '@/lib/opsForm';
import { addWeeklySlots, updateSlotSeats } from '@/server/db/availability';
import { idOrLeave, opsCallerOrLeave } from '@/server/opsAccess';
import { systemClock } from '@/server/ports/clock';

/** Adds a weekly slot for each day ticked, and opens the weeks ahead for them. */
export async function addWeeklySlotsAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(experiencesPath);
  const experienceId = idOrLeave(formData, 'experienceId', experiencesPath);
  const here = availabilityPath(experienceId);
  const parsed = parseAddSlotsForm((name) => formData.get(name), experienceId);
  if (parsed.status === 'invalid') {
    redirect(noticeHref(here, 'invalid', parsed.fields));
  }

  const result = await addWeeklySlots(caller, parsed.input, systemClock.now());
  switch (result.status) {
    case 'experience_not_found':
      redirect(experiencesPath);
    case 'added':
      redirect(noticeHref(here, 'added'));
    case 'duplicate_slot':
    case 'invalid_time_zone':
      redirect(noticeHref(here, result.status));
  }
}

/** Changes one slot's seat cap, and the upcoming sessions that follow it. A bad number is a notice, not a field: the page has one such form per slot. */
export async function updateSlotSeatsAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(experiencesPath);
  const experienceId = idOrLeave(formData, 'experienceId', experiencesPath);
  const here = availabilityPath(experienceId);
  const parsed = parseSeatsForm((name) => formData.get(name));
  if (parsed.status === 'invalid') redirect(noticeHref(here, 'invalid'));

  const result = await updateSlotSeats(caller, parsed.input, systemClock.now());
  switch (result.status) {
    case 'saved':
      redirect(noticeHref(here, 'seats_saved'));
    case 'unchanged':
      redirect(noticeHref(here, 'seats_unchanged'));
    case 'below_sold_and_held':
      redirect(noticeHref(here, 'below_sold_and_held'));
    case 'template_not_found':
      redirect(noticeHref(here, 'slot_gone'));
  }
}
