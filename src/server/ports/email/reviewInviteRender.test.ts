import { describe, expect, it } from 'vitest';
import { reviewInviteData } from '@/lib/email/reviewInvite';
import { parseEmailRequest } from '@/lib/email/templates';
import { renderEmail } from './render';

// Behaviours under test:
// - the invite names the experience, shows the link as a button and as plain text, and says how long it works
// - the subject asks about the experience
// - the plain-text part has no tags, and neither part has an em dash

const token = 'A'.repeat(43);
const data = reviewInviteData(
  {
    leadGuestName: 'Noor Haddad',
    experienceName: 'Pots & pans night',
    hostName: 'Kiln & Clay',
    startsAt: new Date('2026-11-15T22:00:00Z'),
    timeZone: 'America/New_York',
  },
  { reference: 'RMB-7K3M9Q', token, appUrl: 'https://ramble.example' },
);

async function rendered() {
  return renderEmail(
    parseEmailRequest({
      template: 'review-invite',
      to: 'noor@example.com',
      data,
      idempotencyKey: 'review-invite-render',
    }),
    'https://ramble.example',
  );
}

describe('the review invite email', () => {
  it('names the experience, carries the link as a button and as text, and says how long it works', async () => {
    const { html, text, subject } = await rendered();

    expect(subject).toBe('How was Pots & pans night?');
    expect(html).toContain('href="' + data.reviewUrl + '"');
    expect(html).toContain('Pots &amp; pans night');
    expect(html).toContain('works for 90 days');
    expect(text).toContain(data.reviewUrl);
    expect(text).toContain('Write a review');
  });

  it('has no tags in the plain text and no em dash anywhere', async () => {
    const { html, text } = await rendered();

    expect(text).not.toMatch(/<[a-z/][^>]*>/i);
    expect(html + text).not.toContain('—');
  });
});
