import { z } from 'zod';
import { reviewCopy } from '../copy/review';
import { isReviewLink, reviewWindowMs } from '../reviews';
import { reviewPath } from '../routes';
import { nameClip, oneLineClipped } from '../text';
import { msPerDay } from '../time';
import { zonedDayLabel } from '../zonedLabels';
import { absolute, greetingName } from '../bookingEmails';
import { line, link } from './bookingTemplates';

// The invite to review a session that has taken place. The link carries a capability token for the
// order, so the form needs no account; the markup only lays out the text decided here.

const windowDays = Math.round(reviewWindowMs / msPerDay);

export const ReviewInviteDataSchema = z.object({
  recipientName: line(nameClip.person),
  experienceName: line(nameClip.experience),
  hostName: line(nameClip.person),
  dayLabel: line(60),
  reviewUrl: link,
  windowDays: z.int().min(1).max(365),
});

export type ReviewInviteData = z.infer<typeof ReviewInviteDataSchema>;

export function reviewInviteSubject(data: ReviewInviteData): string {
  return `How was ${oneLineClipped(data.experienceName, nameClip.subject)}?`;
}

/**
 * The link to the review form. The reference and token must be well formed: anything else is a bug
 * in the caller, and a link that cannot open a form must never be sent.
 */
export function reviewLink(
  reference: string,
  token: string,
  appUrl: string,
): string {
  if (!isReviewLink(reference, token)) {
    throw new RangeError('That is not a review link');
  }
  return absolute(reviewPath(reference, token), appUrl);
}

export function reviewInviteData(
  source: {
    leadGuestName: string | null;
    experienceName: string;
    hostName: string;
    startsAt: Date;
    timeZone: string;
  },
  input: { reference: string; token: string; appUrl: string },
): ReviewInviteData {
  return {
    recipientName: greetingName(source.leadGuestName),
    experienceName: oneLineClipped(source.experienceName, nameClip.experience),
    hostName: oneLineClipped(source.hostName, nameClip.person),
    dayLabel: zonedDayLabel(source.startsAt, source.timeZone),
    reviewUrl: reviewLink(input.reference, input.token, input.appUrl),
    windowDays,
  };
}

/** What the invite says: finished text, so the markup holds no wording. */
export function reviewInviteBody(data: ReviewInviteData) {
  const invite = reviewCopy.invite;
  return {
    preview: invite.preview(data.experienceName),
    heading: invite.heading(data.experienceName),
    greeting: invite.greeting(data.recipientName),
    intro: invite.intro(data.hostName, data.dayLabel),
    buttonLabel: invite.buttonLabel,
    linkLead: invite.linkLead,
    note: invite.note(data.windowDays),
  };
}
