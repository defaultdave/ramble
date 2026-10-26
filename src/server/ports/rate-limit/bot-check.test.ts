import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotVerdict } from '@/lib/botCheck';

const checkBotId = vi.hoisted(() => vi.fn());
vi.mock('botid/server', () => ({ checkBotId }));

async function load() {
  vi.resetModules();
  return import('./bot-check');
}

const person: BotVerdict = {
  isHuman: true,
  isBot: false,
  isVerifiedBot: false,
};
const bot: BotVerdict = { isHuman: false, isBot: true, isVerifiedBot: false };

describe('checkBot with an injected verdict', () => {
  it.each([
    ['a person', person, 'human'],
    ['a bot', bot, 'bot'],
    ['a verified crawler', { ...bot, isVerifiedBot: true }, 'bot'],
  ] as const)('answers %s with %s', async (_name, verdict, expected) => {
    const { checkBot } = await load();

    await expect(checkBot(() => Promise.resolve(verdict))).resolves.toBe(
      expected,
    );
  });

  it('fails closed when the lookup fails', async () => {
    const { checkBot } = await load();

    await expect(
      checkBot(() => Promise.reject(new Error('BotID unreachable'))),
    ).rejects.toThrow('BotID unreachable');
  });
});

describe('checkBot with the platform', () => {
  beforeEach(() => {
    checkBotId.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes without calling BotID off Vercel', async () => {
    vi.stubEnv('VERCEL', undefined);
    const { checkBot } = await load();

    await expect(checkBot()).resolves.toBe('human');
    expect(checkBotId).not.toHaveBeenCalled();
  });

  it.each([
    ['a person', person, 'human'],
    ['a bot', bot, 'bot'],
  ] as const)(
    'asks BotID on Vercel and answers %s with %s',
    async (_n, verdict, expected) => {
      vi.stubEnv('VERCEL', '1');
      checkBotId.mockResolvedValue({ ...verdict, bypassed: false });
      const { checkBot } = await load();

      await expect(checkBot()).resolves.toBe(expected);
      expect(checkBotId).toHaveBeenCalledOnce();
    },
  );
});
