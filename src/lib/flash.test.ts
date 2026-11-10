import { describe, expect, it } from 'vitest';
import { parseFlash, serializeFlash } from './flash';

// Behaviours under test, one per decision, branch or risk:
// - what serializeFlash writes, parseFlash reads back
// - a long message is cut when written, so what is written is always readable
// - a missing, unparsable, oversized, wrongly shaped, or unknown-tone value shows nothing

describe('flash round trip', () => {
  it('reads back what was written', () => {
    const flash = { tone: 'success', message: 'Order refunded.' } as const;
    expect(parseFlash(serializeFlash(flash))).toEqual(flash);
  });

  it('cuts a long message to a readable one', () => {
    const written = serializeFlash({ tone: 'info', message: 'x'.repeat(500) });
    expect(parseFlash(written)?.message).toHaveLength(200);
  });
});

describe('parseFlash', () => {
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not JSON', 'refunded'],
    ['not an object', '"hi"'],
    ['an unknown tone', '{"tone":"loud","message":"Hi"}'],
    ['an empty message', '{"tone":"info","message":""}'],
    ['an extra field', '{"tone":"info","message":"Hi","html":"<b>"}'],
    [
      'an oversized value',
      JSON.stringify({ tone: 'info', message: 'x'.repeat(450) }),
    ],
  ])('shows nothing for %s', (_case, raw) => {
    expect(parseFlash(raw)).toBeNull();
  });
});
