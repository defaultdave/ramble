import { describe, expect, it } from 'vitest';
import { hostInviteData } from '@/lib/email/hostInvite';
import { parseEmailRequest } from '@/lib/email/templates';
import { renderEmail } from './render';

// Behaviours under test:
// - the invite names the host, shows the link as a button and as plain text, and says it works once and for how long
// - it says where to ask for a new link, and the subject names the host
// - the plain-text part has no tags, and neither part has an em dash

const token = 'AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf';
const data = hostInviteData('Spoke & Saddle', token, 'https://ramble.example');

async function rendered() {
  return renderEmail(
    parseEmailRequest({
      template: 'host-invite',
      to: 'owner@example.com',
      data,
      idempotencyKey: 'host-invite-render',
    }),
    'https://ramble.example',
  );
}

describe('the host invite email', () => {
  it('names the host and carries the link in the button and in plain text, with its one use and lifetime', async () => {
    const { html, text, subject } = await rendered();

    expect(subject).toBe('You are set up on Ramble: Spoke & Saddle');
    expect(html).toContain('href="' + data.url.replaceAll('&', '&amp;') + '"');
    expect(html).toContain('Spoke &amp; Saddle');
    expect(html).toContain('It works once and expires in 5 minutes.');
    expect(text).toContain(data.url);
    expect(text).toMatch(/spoke & saddle/i);
  });

  it('says where to ask for a new link once this one has lapsed', async () => {
    const { html, text } = await rendered();

    expect(html).toContain('href="https://ramble.example/sign-in"');
    expect(text).toContain('https://ramble.example/sign-in');
  });

  it('has no tags in the plain text and no em dash anywhere', async () => {
    const { html, text } = await rendered();

    expect(text).not.toMatch(/<[a-z/][^>]*>/i);
    expect(html + text).not.toContain('—');
  });
});
