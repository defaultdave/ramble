import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onScreenSignInLink } from './onScreenLink';

const holdsAnyRoleGrant = vi.hoisted(() => vi.fn());
const getEmailConfig = vi.hoisted(() => vi.fn());
const sendEmail = vi.hoisted(() => vi.fn());
const createSignInLinkToken = vi.hoisted(() => vi.fn());
vi.mock('@/server/db/roleGrants', () => ({ holdsAnyRoleGrant }));
vi.mock('@/server/ports/email/config', () => ({ getEmailConfig }));
vi.mock('@/server/ports/email', () => ({ sendEmail }));
vi.mock('./signInLink', () => ({ createSignInLinkToken }));
vi.mock('@/server/env', () => ({ env: { APP_URL: 'http://localhost:3000' } }));

// Behaviours under test, one per decision, branch, or risk:
// - in sink mode a guest address gets the confirm path with the token and destination, one link made, and the same link emailed
// - in sink mode a role holder gets null, and no link is made, so no token for it exists
// - in any other mode nobody gets a link on the page, and none is made
// - the grant read and the mode read happen on every call, whichever way it goes, so the work does not tell a role holder from a guest

beforeEach(() => {
  vi.resetAllMocks();
  getEmailConfig.mockReturnValue({ mode: 'sink' });
  holdsAnyRoleGrant.mockResolvedValue(false);
  createSignInLinkToken.mockResolvedValue('AbCdEf');
  sendEmail.mockResolvedValue({});
});

describe('onScreenSignInLink', () => {
  it('gives a guest the confirm path in sink mode, and emails the same link', async () => {
    const path = await onScreenSignInLink('sam@example.com', '/account');

    expect(path).toBe('/sign-in/confirm?token=AbCdEf&next=%2Faccount');
    expect(createSignInLinkToken).toHaveBeenCalledOnce();
    expect(createSignInLinkToken).toHaveBeenCalledWith('sam@example.com');
    const [message] = sendEmail.mock.calls[0] as [
      { template: string; to: string; data: { url: string } },
    ];
    expect(message.template).toBe('sign-in-link');
    expect(message.to).toBe('sam@example.com');
    expect(message.data.url).toBe(
      'http://localhost:3000/sign-in/confirm?token=AbCdEf&next=%2Faccount',
    );
  });

  it('gives a role holder nothing in sink mode, and makes no link', async () => {
    holdsAnyRoleGrant.mockResolvedValue(true);

    expect(await onScreenSignInLink('ops@example.com', '/')).toBeNull();
    expect(createSignInLinkToken).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each([['allowlist'], ['live']])(
    'gives nobody a link in %s mode',
    async (mode) => {
      getEmailConfig.mockReturnValue({ mode });

      expect(await onScreenSignInLink('sam@example.com', '/')).toBeNull();
      expect(createSignInLinkToken).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['sink, a guest', 'sink', false],
    ['sink, a role holder', 'sink', true],
    ['live, a guest', 'live', false],
  ])('reads the grants and the mode when %s', async (_label, mode, holds) => {
    getEmailConfig.mockReturnValue({ mode });
    holdsAnyRoleGrant.mockResolvedValue(holds);

    await onScreenSignInLink('sam@example.com', '/');

    expect(holdsAnyRoleGrant).toHaveBeenCalledWith('sam@example.com');
    expect(getEmailConfig).toHaveBeenCalledOnce();
  });
});
