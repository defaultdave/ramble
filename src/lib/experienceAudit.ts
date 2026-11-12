import { userActor, type AuditEntryInput } from './audit';
import { pauseTransitions, type PauseKind } from './experiencePause';
import type { RejectionReason } from './experienceReview';
import type {
  ExperienceContent,
  ExperienceContentField,
} from './experienceEditor';

// The audit rows of the experience editor. An ops user does these, so the actor is always a named
// user. Details hold ids, flags and amounts only: the audit log refuses a name or a sentence, and
// holds at most 16 keys, so the fields are reported by group.

const changeGroups = {
  name: 'text',
  slug: 'text',
  description: 'text',
  meetingPoint: 'text',
  included: 'text',
  accessibilityNotes: 'text',
  durationMinutes: 'text',
  categoryId: 'place',
  neighborhoodId: 'place',
  cancellationTierId: 'cancellation',
  outdoor: 'weather',
  weatherPolicy: 'weather',
  weatherDecisionHours: 'weather',
  ageRule: 'age',
  minAge: 'age',
  maxAge: 'age',
  taxTreatment: 'tax',
  waiverRequired: 'waiver',
  waiverDocumentId: 'waiver',
  linkOutUrl: 'links',
  affiliateUrl: 'links',
  adultPriceMinor: 'prices',
  childPriceMinor: 'prices',
  childUsesSpace: 'prices',
} as const satisfies Record<ExperienceContentField, string>;

export function experienceCreatedEntry(
  userId: string,
  experienceId: string,
  hostId: string,
): AuditEntryInput {
  return {
    ...userActor(userId),
    action: 'experience.created',
    subjectKind: 'experience',
    subjectId: experienceId,
    details: { host_id: hostId },
  };
}

/**
 * Which groups of fields changed, and for the money and the rules that bind a booking, the new
 * values: the two prices, the tax treatment and the cancellation tier.
 */
export function experienceUpdatedEntry(
  userId: string,
  experienceId: string,
  changed: readonly ExperienceContentField[],
  after: ExperienceContent,
): AuditEntryInput {
  const details: Record<string, boolean | number | string | null> = {};
  for (const field of changed) details[`changed_${changeGroups[field]}`] = true;
  if (details.changed_prices === true) {
    details.adult_price_minor = after.adultPriceMinor;
    details.child_price_minor = after.childPriceMinor;
  }
  if (details.changed_tax === true) details.tax_treatment = after.taxTreatment;
  if (details.changed_cancellation === true) {
    details.cancellation_tier_id = after.cancellationTierId;
  }
  return {
    ...userActor(userId),
    action: 'experience.updated',
    subjectKind: 'experience',
    subjectId: experienceId,
    details,
  };
}

/** A photo added to an experience: the photo's id, where it sits, whether it is decorative, and the basis of the rights to it. No alt text or credit, which are sentences. */
export function photoAddedEntry(
  userId: string,
  experienceId: string,
  photo: {
    photoId: string;
    position: number;
    decorative: boolean;
    rightsBasis: string;
  },
): AuditEntryInput {
  return {
    ...userActor(userId),
    action: 'experience.photo_added',
    subjectKind: 'experience',
    subjectId: experienceId,
    details: {
      photo_id: photo.photoId,
      position: photo.position,
      decorative: photo.decorative,
      rights_basis: photo.rightsBasis,
    },
  };
}

/** An experience in review approved to live. */
export function experienceApprovedEntry(
  userId: string,
  experienceId: string,
): AuditEntryInput {
  return {
    ...userActor(userId),
    action: 'experience.approved',
    subjectKind: 'experience',
    subjectId: experienceId,
    details: { from_status: 'in_review', to_status: 'live' },
  };
}

/** An experience in review sent back to draft, with the reason's code. */
export function experienceRejectedEntry(
  userId: string,
  experienceId: string,
  reason: RejectionReason,
): AuditEntryInput {
  return {
    ...userActor(userId),
    action: 'experience.rejected',
    subjectKind: 'experience',
    subjectId: experienceId,
    details: { from_status: 'in_review', to_status: 'draft', reason },
  };
}

/**
 * An experience paused or unpaused by ops, one row each. `via_host_suspension` says the row came
 * from suspending or unsuspending the host, which is how a suspension finds the experiences it
 * paused without a status of its own.
 */
export function experiencePauseEntry(
  userId: string,
  experienceId: string,
  kind: PauseKind,
  viaHostSuspension: boolean,
): AuditEntryInput {
  const { from, to } = pauseTransitions[kind];
  return {
    ...userActor(userId),
    action: kind === 'pause' ? 'experience.paused' : 'experience.unpaused',
    subjectKind: 'experience',
    subjectId: experienceId,
    details: {
      from_status: from,
      to_status: to,
      via_host_suspension: viaHostSuspension,
    },
  };
}
