import { describe, expect, it } from 'vitest';
import { resolveBadgeTone } from './badge';

describe('resolveBadgeTone', () => {
  it.each(['green', 'yellow', 'blue', 'pink', 'neutral'])(
    'keeps the known tone %s',
    (tone) => {
      expect(resolveBadgeTone(tone)).toBe(tone);
    },
  );

  it.each([undefined, null, '', 'purple', 'GREEN'])(
    'falls back to neutral for %j',
    (tone) => {
      expect(resolveBadgeTone(tone)).toBe('neutral');
    },
  );
});
