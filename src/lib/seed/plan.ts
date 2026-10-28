import { occurrencesBetween, splitUpcoming } from '@/lib/sessions';
import type { ExperienceFixture, HostFixture, SlotFixture } from './types';

export const defaultTimeZone = 'America/New_York';

/** ADR 0008: sessions are generated eight weeks ahead. */
export const sessionWeeksAhead = 8;

const dayMs = 86_400_000;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The dates sessions are generated for. It starts a day before `now` so a host's evening on the
 * calendar day that is still today in New York is not cut off by UTC, and the generator itself
 * skips whatever has already started.
 */
export function seedSessionRange(now: Date): {
  fromDate: string;
  toDate: string;
} {
  const from = now.getTime() - dayMs;
  return {
    fromDate: isoDate(from),
    toDate: isoDate(from + sessionWeeksAhead * 7 * dayMs),
  };
}

/** A slot as the template stores it: the start time carries its seconds. */
export function storedStartTime(slot: Pick<SlotFixture, 'startTime'>): string {
  return `${slot.startTime}:00`;
}

/** Spaces left to seats sold. A session cannot sell more than its allocation or less than nothing. */
export function seatsSoldFor(allocation: number, spacesLeft: number): number {
  return Math.min(allocation, Math.max(0, allocation - spacesLeft));
}

export type PlannedSession = {
  experienceSlug: string;
  weekday: number;
  /** HH:MM:SS, as the template stores it. */
  startTime: string;
  localDate: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  allocation: number;
  seatsSold: number;
  source: 'ramble' | 'allocation';
};

function planSlot(
  experienceSlug: string,
  slot: SlotFixture,
  timeZone: string,
  range: { fromDate: string; toDate: string },
  now: Date,
): PlannedSession[] {
  const startTime = storedStartTime(slot);
  const occurrences = occurrencesBetween(
    { weekday: slot.weekday, startTime, durationMinutes: slot.durationMinutes },
    timeZone,
    range.fromDate,
    range.toDate,
  );
  const leaves = new Map(
    (slot.leaves ?? []).map(({ occurrence, spacesLeft }) => [
      occurrence,
      spacesLeft,
    ]),
  );
  const planned: PlannedSession[] = [];
  occurrences.forEach((occurrence, index) => {
    if (splitUpcoming([occurrence], now).upcoming.length === 0) return;
    const spacesLeft = leaves.get(index);
    planned.push({
      experienceSlug,
      weekday: slot.weekday,
      startTime,
      localDate: occurrence.localDate,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      timeZone,
      allocation: slot.allocation,
      seatsSold:
        spacesLeft === undefined
          ? 0
          : seatsSoldFor(slot.allocation, spacesLeft),
      source: slot.source ?? 'ramble',
    });
  });
  return planned;
}

/** The planned sessions of each experience, by slug. */
export function groupPlanned(
  planned: readonly PlannedSession[],
): Map<string, PlannedSession[]> {
  const groups = new Map<string, PlannedSession[]>();
  for (const session of planned) {
    const list = groups.get(session.experienceSlug) ?? [];
    list.push(session);
    groups.set(session.experienceSlug, list);
  }
  return groups;
}

/** Whether any planned session sells seats; an experience with none needs no second pass. */
export function hasPlannedSeats(planned: readonly PlannedSession[]): boolean {
  return planned.some((session) => session.seatsSold > 0);
}

/** Every session the seed expects to hold at `now`: what generation creates, with the planned seats sold. */
export function planSessions(
  hosts: readonly HostFixture[],
  experiences: readonly ExperienceFixture[],
  now: Date,
): PlannedSession[] {
  const zones = new Map(
    hosts.map((host) => [host.slug, host.timeZone ?? defaultTimeZone]),
  );
  const range = seedSessionRange(now);
  return experiences.flatMap((experience) => {
    const zone = zones.get(experience.hostSlug) ?? defaultTimeZone;
    return experience.slots.flatMap((slot) =>
      planSlot(experience.slug, slot, zone, range, now),
    );
  });
}
