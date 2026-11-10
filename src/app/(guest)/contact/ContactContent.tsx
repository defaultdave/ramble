import { connection } from 'next/server';
import { issueFormGuardToken } from '@/server/formGuard';
import { systemClock } from '@/server/ports/clock';
import { ContactForm } from './ContactForm';

/** Read per request: the form's token starts the minimum fill time, so a prerendered one would be stale on arrival. */
export async function ContactContent() {
  await connection();
  return <ContactForm token={issueFormGuardToken(systemClock.now())} />;
}
