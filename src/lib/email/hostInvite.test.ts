import { describe, expect, it } from 'vitest';
import {
  HostInviteDataSchema,
  hostInviteData,
  hostInviteLandingPath,
  hostInviteSubject,
} from './hostInvite';

// Behaviours under test:
// - the invite's link is the confirm page for the token with the host area as the destination, and says the five minutes every sign-in link lasts
// - the invite carries the page to ask for a new link once this one has lapsed
// - the subject names the host on one line, and a long name is cut
// - the data schema refuses an empty or over-long name and an address that is not http or https

const token = 'AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf';

describe('hostInviteData', () => {
  it('links the confirm page for the token, landing on the host area', () => {
    const data = hostInviteData(
      'Spoke & Saddle',
      token,
      'https://ramble.example',
    );
    const url = new URL(data.url);

    expect(url.origin).toBe('https://ramble.example');
    expect(url.pathname).toBe('/sign-in/confirm');
    expect(url.searchParams.get('token')).toBe(token);
    expect(url.searchParams.get('next')).toBe(hostInviteLandingPath);
    expect(data.expiresInMinutes).toBe(5);
    expect(data.signInUrl).toBe('https://ramble.example/sign-in');
    expect(HostInviteDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('hostInviteSubject', () => {
  it('names the host on one line', () => {
    const data = hostInviteData(
      'Spoke\n& Saddle',
      token,
      'https://ramble.example',
    );

    expect(hostInviteSubject(data)).toBe(
      'You are set up on Ramble: Spoke & Saddle',
    );
  });

  it('cuts a very long name', () => {
    const data = hostInviteData(
      'a'.repeat(300),
      token,
      'https://ramble.example',
    );

    expect(hostInviteSubject(data).length).toBeLessThan(160);
  });
});

describe('HostInviteDataSchema', () => {
  const good = hostInviteData('Host', token, 'https://ramble.example');

  it.each([
    ['an empty name', { hostName: '' }],
    ['a name over 120 characters', { hostName: 'a'.repeat(121) }],
    ['a link that is not http', { url: 'javascript:alert(1)' }],
    ['a sign-in address that is not http', { signInUrl: 'ftp://x.example' }],
    ['a lifetime of zero', { expiresInMinutes: 0 }],
  ])('refuses %s', (_label, change) => {
    expect(HostInviteDataSchema.safeParse({ ...good, ...change }).success).toBe(
      false,
    );
  });
});
