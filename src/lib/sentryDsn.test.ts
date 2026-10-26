import { describe, expect, it } from 'vitest';
import { sentryLoaderUrl } from './sentryDsn';

const key = '0123456789abcdef0123456789abcdef';

describe('sentryLoaderUrl', () => {
  it('builds the loader address from the DSN public key', () => {
    expect(sentryLoaderUrl(`https://${key}@o123.ingest.sentry.io/456`)).toBe(
      `https://js.sentry-cdn.com/${key}.min.js`,
    );
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['not a URL', 'nope'],
    ['plain http', `http://${key}@o1.ingest.sentry.io/1`],
    ['no public key', 'https://o1.ingest.sentry.io/1'],
    ['a key that is not hex', 'https://not-a-key@o1.ingest.sentry.io/1'],
    ['a key that is too short', 'https://abc@o1.ingest.sentry.io/1'],
  ])('returns null for a DSN that is %s', (_name, dsn) => {
    expect(sentryLoaderUrl(dsn)).toBeNull();
  });
});
