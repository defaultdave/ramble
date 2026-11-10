import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { PageError } from '@/components/PageError';
import { PageHeading } from '@/components/PageHeading';
import {
  experiencePath,
  parseExperienceAddress,
  privateSessionPath,
} from '@/lib/routes';
import { venueToday } from '@/lib/venue';
import { getExperiencePage } from '@/server/experiencePage';
import { issueFormGuardToken } from '@/server/formGuard';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { systemClock } from '@/server/ports/clock';
import { PrivateSessionForm } from './PrivateSessionForm';

export const privateSessionTitle = 'Request a private session';

/**
 * Read per request: the form's token starts the minimum fill time, so a prerendered one would be
 * stale on arrival, and the earliest date is today in New York. An address that names no experience
 * a guest can see is a not-found. Without a token the form could not be sent, so the page says so.
 */
export async function PrivateSessionContent({
  slugAndId,
}: {
  slugAndId: Promise<string>;
}) {
  const address = parseExperienceAddress(await slugAndId);
  if (!address) notFound();
  await connection();

  const now = systemClock.now();
  let page;
  let token;
  try {
    page = await getExperiencePage(address.id);
    token = issueFormGuardToken(now);
  } catch (error) {
    rethrowOrLog('The private session form could not be prepared', error);
    return (
      <PageError
        title={privateSessionTitle}
        alertTitle="We couldn't load this form"
        alertBody="Something went wrong on our side. Try again in a moment."
        retryHref={privateSessionPath(address)}
      />
    );
  }
  if (!page) notFound();

  return (
    <PageHeading title={privateSessionTitle}>
      <p>
        Tell us when, how many, and what you have in mind for{' '}
        <strong>{page.experience.name}</strong>. Nothing is booked or charged.
        We reply by email.
      </p>
      <PrivateSessionForm
        token={token}
        experienceId={address.id}
        experienceHref={experiencePath(address)}
        minDate={venueToday(now)}
      />
    </PageHeading>
  );
}
