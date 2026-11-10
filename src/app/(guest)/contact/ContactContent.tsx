import Link from 'next/link';
import { connection } from 'next/server';
import { PageError } from '@/components/PageError';
import { PageHeading } from '@/components/PageHeading';
import { issueFormGuardToken } from '@/server/formGuard';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { systemClock } from '@/server/ports/clock';
import { ContactForm } from './ContactForm';

export const contactTitle = 'Contact';

/**
 * Read per request: the form's token starts the minimum fill time, so a prerendered one would be
 * stale on arrival. Without a token the form could not be sent, so the page says so and keeps its heading.
 */
export async function ContactContent() {
  await connection();
  let token;
  try {
    token = issueFormGuardToken(systemClock.now());
  } catch (error) {
    rethrowOrLog('The contact form token could not be issued', error);
    return (
      <PageError
        title={contactTitle}
        alertTitle="We couldn't load the contact form"
        alertBody="Something went wrong on our side. Try again in a moment."
        retryHref="/contact"
      />
    );
  }
  return (
    <PageHeading title={contactTitle}>
      <p>
        Contact us here. Most questions are answered in the{' '}
        <Link href="/help">help center</Link>, so it is worth a look first.
      </p>
      <ContactForm token={token} />
    </PageHeading>
  );
}
