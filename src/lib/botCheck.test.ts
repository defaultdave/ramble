import { describe, expect, it } from 'vitest';
import {
  botCheckIsLive,
  BotVerdictSchema,
  judgeBotVerdict,
  type BotCheckResult,
  type BotVerdict,
} from './botCheck';

describe('judgeBotVerdict', () => {
  it.each<[string, BotVerdict, BotCheckResult]>([
    [
      'a person',
      { isHuman: true, isBot: false, isVerifiedBot: false },
      'human',
    ],
    ['a bot', { isHuman: false, isBot: true, isVerifiedBot: false }, 'bot'],
    [
      'a verified crawler',
      { isHuman: false, isBot: true, isVerifiedBot: true },
      'bot',
    ],
    [
      'a verdict that says human and bot',
      { isHuman: true, isBot: true, isVerifiedBot: false },
      'bot',
    ],
    [
      'a verdict that says neither',
      { isHuman: false, isBot: false, isVerifiedBot: false },
      'bot',
    ],
  ])('judges %s as %s', (_name, verdict, expected) => {
    expect(judgeBotVerdict(verdict)).toBe(expected);
  });
});

describe('judgeBotVerdict with a malformed verdict', () => {
  it.each([
    ['no fields', {}],
    ['only isHuman', { isHuman: true }],
    ['isBot missing', { isHuman: true, isVerifiedBot: false }],
    ['isVerifiedBot missing', { isHuman: true, isBot: false }],
    [
      'isBot undefined',
      { isHuman: true, isBot: undefined, isVerifiedBot: undefined },
    ],
    ['isBot null', { isHuman: true, isBot: null, isVerifiedBot: false }],
    [
      'strings for booleans',
      { isHuman: 'true', isBot: 'false', isVerifiedBot: 'false' },
    ],
  ])('judges %s as a bot', (_name, verdict) => {
    expect(judgeBotVerdict(verdict)).toBe('bot');
  });
});

describe('BotVerdictSchema', () => {
  it('accepts three booleans', () => {
    expect(
      BotVerdictSchema.safeParse({
        isHuman: true,
        isBot: false,
        isVerifiedBot: false,
      }).success,
    ).toBe(true);
  });

  it.each([
    ['nothing', {}],
    [
      'a body the SDK built from an error response',
      { isHuman: true, isBot: undefined, isVerifiedBot: undefined },
    ],
    ['null', null],
  ])('refuses %s', (_name, value) => {
    expect(BotVerdictSchema.safeParse(value).success).toBe(false);
  });
});

describe('botCheckIsLive', () => {
  it.each([
    ['1', true],
    [undefined, false],
    ['', false],
  ])('is %j -> %s', (vercel, expected) => {
    expect(botCheckIsLive(vercel)).toBe(expected);
  });
});
