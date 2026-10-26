import { describe, expect, it } from 'vitest';
import { resolveRequestId } from './requestId';

const generate = () => 'generated-id';

describe('resolveRequestId', () => {
  it.each([
    [{ requestId: 'req-123', platformId: 'iad1::abc' }, 'req-123'],
    [
      { requestId: null, platformId: 'iad1::abc-1730000000000-0123456789ab' },
      'iad1::abc-1730000000000-0123456789ab',
    ],
    [{ requestId: '  padded  ' }, 'padded'],
    [{}, 'generated-id'],
    [{ requestId: '', platformId: '' }, 'generated-id'],
  ])('resolves %j to %s', (incoming, expected) => {
    expect(resolveRequestId(incoming, generate)).toBe(expected);
  });

  it.each([
    ['too long', 'a'.repeat(65)],
    ['holding a space', 'two words'],
    ['holding a newline', 'abc\ndef'],
    ['holding markup', '<script>'],
    ['holding an email', 'a@b.co'],
    ['starting with a symbol', '-abc'],
  ])('discards an incoming ID that is %s', (_name, requestId) => {
    expect(resolveRequestId({ requestId }, generate)).toBe('generated-id');
  });

  it('falls through to the platform ID when the caller ID is unusable', () => {
    expect(
      resolveRequestId(
        { requestId: 'bad id', platformId: 'good-id' },
        generate,
      ),
    ).toBe('good-id');
  });
});
