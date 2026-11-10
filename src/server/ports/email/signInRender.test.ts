import { describe, expect, it } from 'vitest';
import { parseEmailRequest } from '@/lib/email/templates';
import { renderEmail } from './render';

// Behaviours under test:
// - the sign-in email carries the link as a button and as plain text, says it works once and for how long, and tells a stranger to ignore it
// - the plain-text part holds the link and no tags, and neither part has an em dash

const url =
  'https://ramble.example/api/auth/magic-link/verify?token=AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf&callbackURL=%2Faccount';

async function rendered() {
  return renderEmail(
    parseEmailRequest({
      template: 'sign-in-link',
      to: 'sam@example.com',
      data: { url, expiresInMinutes: 5 },
      idempotencyKey: 'sign-in-link-render',
    }),
    'https://ramble.example',
  );
}

describe('the sign-in link email', () => {
  it('shows the link in the button and in plain text, with its one use and its lifetime', async () => {
    const { html, text, subject } = await rendered();

    expect(subject).toBe('Your Ramble sign-in link');
    expect(html).toContain('href="' + url.replaceAll('&', '&amp;') + '"');
    expect(html).toContain('It works once and expires in 5 minutes.');
    expect(html).toContain('If you did not ask for this link');
    expect(text).toContain(url);
    expect(text).toContain('It works once and expires in 5 minutes.');
  });

  it('has no tags in the plain text and no em dash anywhere', async () => {
    const { html, text } = await rendered();

    expect(text).not.toMatch(/<[a-z/][^>]*>/i);
    expect(html + text).not.toContain('—');
  });
});
