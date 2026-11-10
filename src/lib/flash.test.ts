import { describe, expect, it } from 'vitest';
import { parseFlash, readFlash, serializeFlash } from './flash';

// Behaviours under test, one per decision, branch or risk:
// - what serializeFlash writes, parseFlash reads back
// - a message the cookie cannot hold is refused when written, never cut, so what is written is always readable
// - a missing, unparsable, oversized, wrongly shaped, or unknown-tone value shows nothing

const written = (flash: Parameters<typeof serializeFlash>[0]) => {
  const result = serializeFlash(flash);
  if (!result.ok) throw new Error(`not written: ${result.reason}`);
  return result.value;
};

describe('flash round trip', () => {
  it('reads back what was written', () => {
    const flash = { tone: 'success', message: 'Order refunded.' } as const;
    expect(parseFlash(written(flash))).toEqual(flash);
  });

  it('reads back a quote-heavy message at the longest length that is written', () => {
    // Each quote is escaped to two characters, so 186 of them fill the 400-character cookie exactly.
    const flash = { tone: 'info', message: '"'.repeat(186) } as const;
    const value = written(flash);
    expect(value).toHaveLength(400);
    expect(parseFlash(value)).toEqual(flash);
  });

  it('refuses a message whose cookie would be over the limit, never cutting it', () => {
    expect(serializeFlash({ tone: 'info', message: '"'.repeat(200) })).toEqual({
      ok: false,
      reason: 'too-long',
    });
  });

  it('writes a plain message at the maximum length', () => {
    const flash = { tone: 'info', message: 'x'.repeat(200) } as const;
    expect(parseFlash(written(flash))).toEqual(flash);
  });

  it.each([
    ['an empty message', { tone: 'info', message: '' }],
    [
      'a message over 200 characters',
      { tone: 'info', message: 'x'.repeat(201) },
    ],
    ['an unknown tone', { tone: 'loud', message: 'Hi' }],
  ])('refuses %s as invalid', (_case, flash) => {
    expect(
      serializeFlash(flash as Parameters<typeof serializeFlash>[0]),
    ).toEqual({ ok: false, reason: 'invalid' });
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

describe('readFlash reasons', () => {
  it.each([
    [undefined, 'missing'],
    ['x'.repeat(401), 'too-long'],
    ['{nope', 'not-json'],
    ['{"tone":"loud","message":"Hi"}', 'wrong-shape'],
  ])('reads %j as %s', (raw, reason) => {
    expect(readFlash(raw)).toEqual({ ok: false, reason });
  });

  it('returns the flash when the value is ours', () => {
    expect(readFlash('{"tone":"info","message":"Hi"}')).toEqual({
      ok: true,
      flash: { tone: 'info', message: 'Hi' },
    });
  });
});
