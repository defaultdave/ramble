import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { emailSuppressions } from '@/server/db/schema';
import {
  client,
  email,
  fakeEvent,
  live,
  post,
  request,
  resendAccepts,
  rowFor,
  setMode,
  setupEmailDatabase,
  signingSecret,
} from './emailFixtures';

vi.mock('@/server/env', async () => ({
  env: (await import('./emailFixtures')).testEnv,
}));

// Behaviours under test, one per decision, branch, or risk:
// - delivered moves a sent message to delivered
// - a hard bounce and a complaint move it and suppress the address, and the next send to it is suppressed
// - a late delivered does not undo a bounce, and a replayed bounce leaves one suppression
// - an event for a message Ramble never sent changes nothing
// - a signed Resend bounce suppresses, and a transient one does not

setupEmailDatabase();

describe('the delivery webhook', () => {
  async function capture() {
    const input = request();
    await email.sendEmail(input);
    const row = await rowFor(input.idempotencyKey);
    return { input, row, providerId: row.providerMessageId ?? '' };
  }

  const suppressionsFor = (address: string) =>
    client.db
      .select()
      .from(emailSuppressions)
      .where(eq(emailSuppressions.address, address));

  it('moves a message to delivered', async () => {
    const { input, providerId } = await capture();

    expect((await fakeEvent(providerId, 'delivered')).status).toBe(200);

    expect((await rowFor(input.idempotencyKey)).status).toBe('delivered');
    expect(await suppressionsFor(input.to)).toEqual([]);
  });

  it.each([
    ['hard_bounce', 'bounced'],
    ['complaint', 'complained'],
  ])(
    'moves a message on a %s to %s and suppresses the address',
    async (event, status) => {
      const { input, row, providerId } = await capture();

      expect((await fakeEvent(providerId, event)).status).toBe(200);

      expect((await rowFor(input.idempotencyKey)).status).toBe(status);
      expect(await suppressionsFor(input.to)).toMatchObject([
        { reason: event, sourceMessageId: row.id },
      ]);
      const next = await email.sendEmail(request({ to: input.to }));
      expect(next.status).toBe('suppressed');
    },
  );

  it('keeps a bounce when a delivered arrives late, and a replayed bounce adds no second suppression', async () => {
    const { input, providerId } = await capture();

    await fakeEvent(providerId, 'hard_bounce');
    await fakeEvent(providerId, 'delivered');
    await fakeEvent(providerId, 'hard_bounce');

    expect((await rowFor(input.idempotencyKey)).status).toBe('bounced');
    expect(await suppressionsFor(input.to)).toHaveLength(1);
  });

  it('changes nothing for a message Ramble never sent', async () => {
    const before = await client.db.$count(emailSuppressions);

    const result = await fakeEvent('fake-unknown', 'hard_bounce');

    expect(result.status).toBe(200);
    expect(await client.db.$count(emailSuppressions)).toBe(before);
  });

  it('acts on a signed Resend bounce when permanent, and not when transient', async () => {
    setMode(live);
    resendAccepts();
    const permanent = request();
    const transient = request();
    await email.sendEmail(permanent);
    await email.sendEmail(transient);
    const permanentId = (await rowFor(permanent.idempotencyKey))
      .providerMessageId;
    const transientId = (await rowFor(transient.idempotencyKey))
      .providerMessageId;

    const signed = (emailId: string, bounceType: string) => {
      const body = JSON.stringify({
        type: 'email.bounced',
        data: { email_id: emailId, bounce: { type: bounceType } },
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac(
        'sha256',
        Buffer.from(signingSecret.replace('whsec_', ''), 'base64'),
      )
        .update(`msg_1.${timestamp}.${body}`)
        .digest('base64');
      return post(body, {
        'svix-id': 'msg_1',
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${signature}`,
      });
    };

    expect((await signed(permanentId ?? '', 'Permanent')).status).toBe(200);
    expect((await signed(transientId ?? '', 'Transient')).status).toBe(200);

    expect((await rowFor(permanent.idempotencyKey)).status).toBe('bounced');
    expect((await rowFor(transient.idempotencyKey)).status).toBe('sent');
    expect(await suppressionsFor(permanent.to)).toHaveLength(1);
    expect(await suppressionsFor(transient.to)).toHaveLength(0);
  });
});
