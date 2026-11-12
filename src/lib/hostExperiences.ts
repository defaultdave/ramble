import { priceKindLabel, type HostExperience } from './catalog';
import {
  experienceStatusLabels,
  experienceStatusTones,
} from './experienceEditor';
import type { HostAccess } from './hostAccess';
import { formatPrice } from './money';
import type { StatusTone } from './statusBadge';

// What a host owner sees of their own experiences, read only: the facts a guest books against.
// Changing any of them stays with ops.

export const hostExperiencesPath = '/host/experiences';

export type HostExperienceRowView = {
  id: string;
  name: string;
  statusLabel: string;
  statusTone: StatusTone;
  /** One line per price option, "Adult $85", the adult price first. */
  prices: string[];
  /** The tier by name and what it refunds. */
  cancellation: string;
  waiver: string;
};

export type HostExperiencesView = { rows: HostExperienceRowView[] };

/** The refund window of a tier in words: the one place that turns its hours into a sentence. */
export function refundWindowLabel(hoursBefore: number): string {
  if (hoursBefore === 0) return 'full refund until the session starts';
  const unit = hoursBefore === 1 ? 'hour' : 'hours';
  return `full refund up to ${String(hoursBefore)} ${unit} before`;
}

export function buildHostExperiences(
  experiences: readonly HostExperience[],
): HostExperiencesView {
  return {
    rows: experiences.map((experience) => ({
      id: experience.id,
      name: experience.name,
      statusLabel: experienceStatusLabels[experience.status],
      statusTone: experienceStatusTones[experience.status],
      prices: experience.priceOptions.map(
        (option) =>
          `${priceKindLabel(option.kind)} ${formatPrice(option.priceMinor)}`,
      ),
      cancellation: `${experience.cancellationTier.name}: ${refundWindowLabel(experience.cancellationTier.fullRefundHoursBefore)}`,
      waiver: experience.waiverRequired
        ? 'Guests accept a waiver'
        : 'No waiver',
    })),
  };
}

export type HostExperiencesResult =
  | { status: 'signed_out' }
  | { status: 'refused' }
  | { status: 'ok'; view: HostExperiencesView };

/** What the page does with a request: nobody signed in is told to sign in, and anyone else who owns no host is refused. */
export function hostExperiencesResult(
  access: HostAccess,
  experiences: readonly HostExperience[] | null,
): HostExperiencesResult {
  if (access.kind === 'signed_out') return { status: 'signed_out' };
  if (access.kind === 'not_a_host_owner' || experiences === null) {
    return { status: 'refused' };
  }
  return { status: 'ok', view: buildHostExperiences(experiences) };
}
