import { cancellationTerms } from './cancellation';
import { priceKindLabel, type HostExperience } from './catalog';
import {
  experienceStatusLabels,
  experienceStatusTones,
} from './experienceEditor';
import { hostAreaResult, type HostAccess } from './hostAccess';
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
  /** The price options in one line, "Adult $85 · Child $42.50", the adult price first. */
  pricesLabel: string;
  /** The tier by name and its terms, worded as the ops editor and the guest pages word them. */
  cancellation: string;
  waiver: string;
};

export type HostExperiencesView = { rows: HostExperienceRowView[] };

export function buildHostExperiences(
  experiences: readonly HostExperience[],
): HostExperiencesView {
  return {
    rows: experiences.map((experience) => ({
      id: experience.id,
      name: experience.name,
      statusLabel: experienceStatusLabels[experience.status],
      statusTone: experienceStatusTones[experience.status],
      pricesLabel:
        experience.priceOptions.length === 0
          ? 'None set'
          : experience.priceOptions
              .map(
                (option) =>
                  `${priceKindLabel(option.kind)} ${formatPrice(option.priceMinor)}`,
              )
              .join(' · '),
      cancellation: `${experience.cancellationTier.name}: ${cancellationTerms(experience.cancellationTier).fact}`,
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

/** What the page does with a request; see `hostAreaResult`. */
export function hostExperiencesResult(
  access: HostAccess,
  experiences: readonly HostExperience[] | null,
): HostExperiencesResult {
  return hostAreaResult(access, experiences, (read) => ({
    status: 'ok',
    view: buildHostExperiences(read),
  }));
}
