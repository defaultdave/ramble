import { describe, expect, it } from 'vitest';
import {
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
