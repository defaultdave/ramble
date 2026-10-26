import { describe, expect, it } from 'vitest';
import {
  defaultLimits,
  isSensitiveKey,
  redact,
  redactString,
  REDACTED,
  TRUNCATED,
} from './redact';

// A 32-byte capability token as base64url, the shape of an HMAC-SHA256 capability token.
const capabilityToken = 'q7Hk2mVx9RtLw3NfZ8bYc1DsJ6aPe4UoG0iAhXnT5vE';

describe('redaction behaviours', () => {
  describe('field names', () => {
    it.each([
      'password',
      'Password',
      'currentPassword',
      'apiKey',
      'x-api-key',
      'Authorization',
      'Set-Cookie',
      'cookie',
      'manageToken',
      'capability_token',
      'tokenHash',
      'client_secret',
      'CAPABILITY_TOKEN_SECRET',
      'webhookSignature',
      'email',
      'guestEmail',
      'emailAddress',
      'cardNumber',
      'card',
      'cvc',
      'CVV',
      'phone',
      'guardianContact',
      'dob',
      'childBirthDate',
      'dsn',
      'ssn',
    ])('redacts the value of %s', (key) => {
      expect(isSensitiveKey(key)).toBe(true);
      expect(redact({ [key]: 'anything at all' })).toEqual({ [key]: REDACTED });
    });

    it.each([
      'requestId',
      'sessionId',
      'kind',
      'status',
      'orderId',
      'expand',
      'shipping',
      'company',
      'seats',
      'dedupeKey',
    ])('keeps the value of %s', (key) => {
      expect(isSensitiveKey(key)).toBe(false);
      expect(redact({ [key]: 'plain' })).toEqual({ [key]: 'plain' });
    });

    it('redacts a whole sensitive subtree whatever it holds', () => {
      expect(redact({ card: { brand: 'visa', last4: '4242' } })).toEqual({
        card: REDACTED,
      });
    });

    it('applies value rules to a key that is itself an email', () => {
      expect(redact({ 'guest@example.com': 1 })).toEqual({
        '[redacted:email]': 1,
      });
    });
  });

  describe('text', () => {
    it.each([
      [
        'an email',
        'Sent to guest.name+tag@example.co.uk today',
        'Sent to [redacted:email] today',
      ],
      [
        'a card number',
        'card 4242 4242 4242 4242 declined',
        'card [redacted:card] declined',
      ],
      ['a card number with hyphens', '4242-4242-4242-4242', '[redacted:card]'],
      [
        'a card number run together',
        'ref 4242424242424242',
        'ref [redacted:card]',
      ],
      ['an amex number', '378282246310005', '[redacted:card]'],
      [
        'a bearer header',
        'Authorization: Bearer abc123def456ghi789',
        'Authorization: [redacted]',
      ],
      [
        'a bare bearer value',
        'sent Bearer abc123def456ghi789 ok',
        'sent Bearer [redacted] ok',
      ],
      ['a basic header', 'Basic dXNlcjpwYXNzd29yZA==', 'Basic [redacted]'],
      [
        'a JWT',
        'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl end',
        'jwt [redacted:jwt] end',
      ],
      [
        'a Stripe secret key',
        'key sk_live_51Habcdefghijklmnop',
        'key [redacted:key]',
      ],
      ['a Stripe test key', 'sk_test_abcdefghijklmnop12', '[redacted:key]'],
      ['a webhook secret', 'whsec_abcdefghijklmnop12345', '[redacted:key]'],
      [
        'an Axiom token',
        'xaat-12345678-1234-1234-1234-123456789012',
        '[redacted:key]',
      ],
      [
        'a GitHub token',
        'ghp_abcdefghijklmnopqrstuvwxyz0123',
        '[redacted:key]',
      ],
      [
        'database credentials',
        'connect postgres://ramble:hunter2@db.neon.tech/ramble failed',
        'connect postgres://[redacted]@db.neon.tech/ramble failed',
      ],
      [
        'a Sentry DSN',
        'https://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/42',
        'https://[redacted]@o1.ingest.sentry.io/42',
      ],
      [
        'a manage link',
        `https://ramble.example/manage/${capabilityToken}`,
        `https://ramble.example/manage/${REDACTED}`,
      ],
      ['a gift path', '/gift/anything-at-all', `/gift/${REDACTED}`],
      [
        'an order path with a query',
        '/orders/R-1234?utm=x',
        `/orders/${REDACTED}?utm=x`,
      ],
      [
        'a token query parameter',
        '/page?token=abc&page=2',
        `/page?token=${REDACTED}&page=2`,
      ],
      [
        'a short code parameter',
        '/cb?code=123456&state=ok',
        `/cb?code=${REDACTED}&state=ok`,
      ],
      [
        'a bare opaque token',
        `link ${capabilityToken} sent`,
        'link [redacted:token] sent',
      ],
      [
        'a sha256 hex digest',
        `hash ${'a1'.repeat(32)}`,
        'hash [redacted:token]',
      ],
    ])('redacts %s', (_name, input, expected) => {
      expect(redactString(input)).toBe(expected);
    });

    it.each([
      ['a UUID', '9f1c2b7e-4d5a-4e8b-9c3d-1a2b3c4d5e6f'],
      [
        'a long lowercase slug',
        'experiences/central-park-sunrise-photography-walk',
      ],
      ['a millisecond timestamp', 'at 1730000000000'],
      ['a number that fails the card checksum', 'ref 1234567890123'],
      ['an ordinary sentence', 'Payment succeeded for 2 seats'],
      ['an ordinary query string', '/browse?page=2&sort=price'],
      ['a platform request ID', 'iad1::sfo1::abcde-1730000000000-0123456789ab'],
    ])('leaves %s alone', (_name, input) => {
      expect(redactString(input)).toBe(input);
    });

    it('redacts the same text twice to the same result', () => {
      const once = redactString(
        `mail a@b.co card 4242424242424242 /manage/${capabilityToken}`,
      );
      expect(redactString(once)).toBe(once);
    });
  });

  describe('nested values', () => {
    it('finds secrets at any depth, in objects and arrays', () => {
      const input = {
        order: {
          id: 'ord_1',
          guest: { email: 'a@b.co', note: 'write to a@b.co' },
          lines: [
            { sku: 'x', link: `/manage/${capabilityToken}` },
            { sku: 'y', meta: { stripe: { apiKey: 'sk_live_abcdefgh12345' } } },
          ],
        },
        message: `failed for c@d.io with ${capabilityToken}`,
      };

      const out = JSON.stringify(redact(input));

      expect(out).not.toContain('a@b.co');
      expect(out).not.toContain('c@d.io');
      expect(out).not.toContain(capabilityToken);
      expect(out).not.toContain('sk_live');
      expect(out).toContain('ord_1');
      expect(out).toContain('"sku":"y"');
    });

    it('does not change its input', () => {
      const input = {
        email: 'a@b.co',
        nested: { token: 'abc' },
        list: ['a@b.co'],
      };
      const before = JSON.stringify(input);

      redact(input);

      expect(JSON.stringify(input)).toBe(before);
    });

    it('treats Headers and URLSearchParams like objects', () => {
      const headers = new Headers({
        authorization: 'Bearer abc123def456',
        'x-request-id': 'r1',
      });
      expect(redact(headers)).toEqual({
        authorization: REDACTED,
        'x-request-id': 'r1',
      });
      expect(redact(new URLSearchParams({ token: 'abc', page: '2' }))).toEqual({
        token: REDACTED,
        page: '2',
      });
    });

    it('redacts the credentials and path of a URL object', () => {
      expect(
        redact(
          new URL(
            `https://u:p@ramble.example/manage/${capabilityToken}?token=x`,
          ),
        ),
      ).toBe(
        `https://[redacted]@ramble.example/manage/${REDACTED}?token=${REDACTED}`,
      );
    });

    it.each([
      ['a bigint', 10n, '10'],
      ['a symbol', Symbol('s'), '[Symbol]'],
      ['a function', () => 1, '[Function]'],
      ['NaN', Number.NaN, 'NaN'],
      ['infinity', Number.POSITIVE_INFINITY, 'Infinity'],
      ['a date', new Date('2026-10-25T10:00:00Z'), '2026-10-25T10:00:00.000Z'],
      ['an invalid date', new Date('nope'), 'Invalid Date'],
      ['a map', new Map([['a@b.co', 1]]), '[Map of 1]'],
      ['a set', new Set([1, 2]), '[Set of 2]'],
      ['a buffer', Buffer.from('4242424242424242'), '[Binary of 16 bytes]'],
      ['an array buffer', new ArrayBuffer(8), '[Binary of 8 bytes]'],
    ])('summarises %s', (_name, input, expected) => {
      expect(redact(input)).toBe(expected);
    });

    it('keeps plain numbers, booleans, null, and undefined', () => {
      expect(redact({ n: 3, b: false, z: null, u: undefined })).toEqual({
        n: 3,
        b: false,
        z: null,
        u: undefined,
      });
    });

    it('does not let a __proto__ key change the result prototype', () => {
      const input = JSON.parse(
        '{"__proto__": {"polluted": true}, "a": 1}',
      ) as object;

      const out = redact(input) as Record<string, unknown>;

      expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.keys(out)).toContain('__proto__');
    });

    it('survives a getter that throws', () => {
      const input = {
        ok: 1,
        get boom(): string {
          throw new Error('nope');
        },
      };

      expect(redact(input)).toEqual({ ok: 1, boom: '[unredactable]' });
    });
  });

  describe('errors', () => {
    it('redacts the message, the stack, and the cause chain', () => {
      const cause = new Error(`db down for ${capabilityToken}`);
      const error = new Error('could not email a@b.co', { cause });

      const out = redact(error) as Record<string, unknown>;
      const text = JSON.stringify(out);

      expect(out.name).toBe('Error');
      expect(out.message).toBe('could not email [redacted:email]');
      expect(text).not.toContain('a@b.co');
      expect(text).not.toContain(capabilityToken);
      expect((out.cause as Record<string, unknown>).message).toBe(
        'db down for [redacted:token]',
      );
    });

    it('copies only name, message, stack, code, and cause', () => {
      const error = Object.assign(new Error('duplicate key'), {
        code: '23505',
        detail: 'Key (email)=(a@b.co) already exists.',
        query: 'insert into guests (email) values ($1)',
        parameters: ['a@b.co'],
      });

      const out = redact(error) as Record<string, unknown>;

      expect(out.code).toBe('23505');
      expect(Object.keys(out).sort()).toEqual(
        ['code', 'message', 'name', 'stack'].sort(),
      );
      expect(JSON.stringify(out)).not.toContain('a@b.co');
    });

    it('redacts every member of an AggregateError', () => {
      const error = new AggregateError([new Error('x a@b.co')], 'many');

      expect(JSON.stringify(redact(error))).not.toContain('a@b.co');
    });

    it('redacts an error nested in a field', () => {
      const out = JSON.stringify(
        redact({ error: new Error('bad 4242424242424242') }),
      );

      expect(out).not.toContain('4242424242424242');
    });

    it('redacts a thrown string', () => {
      expect(redact('plain a@b.co')).toBe('plain [redacted:email]');
    });
  });

  describe('bounds', () => {
    it('stops at the depth limit', () => {
      const deep = { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } };

      const out = JSON.stringify(redact(deep));

      expect(out).toContain(TRUNCATED);
      expect(out).not.toContain('"h"');
    });

    it('keeps at most maxArrayItems items and says how many were dropped', () => {
      const out = redact(Array.from({ length: 80 }, (_, i) => i)) as unknown[];

      expect(out).toHaveLength(defaultLimits.maxArrayItems + 1);
      expect(out.at(-1)).toBe(`${TRUNCATED} 30 more items`);
    });

    it('keeps at most maxKeys keys and says how many were dropped', () => {
      const wide = Object.fromEntries(
        Array.from({ length: 150 }, (_, i) => [`k${String(i)}`, i]),
      );

      const out = redact(wide) as Record<string, unknown>;

      expect(Object.keys(out)).toHaveLength(defaultLimits.maxKeys + 1);
      expect(out[TRUNCATED]).toBe('50 more keys');
    });

    it('cuts a long string', () => {
      const out = redactString('a b '.repeat(2000));

      expect(out.length).toBe(defaultLimits.maxStringLength + TRUNCATED.length);
      expect(out.endsWith(TRUNCATED)).toBe(true);
    });

    it('bounds the total work on a wide and deep structure', () => {
      let tree: unknown = 'leaf';
      for (let level = 0; level < 5; level += 1) {
        tree = Array.from({ length: 50 }, () => tree);
      }
      const start = performance.now();

      const out = JSON.stringify(redact(tree));

      expect(performance.now() - start).toBeLessThan(1_000);
      expect(out.length).toBeLessThan(200_000);
      expect(out).toContain(TRUNCATED);
    });

    it('bounds the total characters kept across many strings', () => {
      const many = Array.from({ length: 50 }, () => 'x y '.repeat(500));

      const out = redact(many) as string[];
      const kept = out.reduce((sum, s) => sum + s.length, 0);

      expect(kept).toBeLessThanOrEqual(
        defaultLimits.maxTotalChars + 50 * TRUNCATED.length,
      );
      expect(out.at(-1)).toBe(TRUNCATED);
    });

    it('takes linear time on a megabyte with no @ or card', () => {
      const start = performance.now();

      redactString('a.'.repeat(500_000));
      redactString('1 '.repeat(500_000));
      redactString('a-'.repeat(500_000));

      expect(performance.now() - start).toBeLessThan(2_000);
    });

    it('does not leave half a token where an oversized string is cut', () => {
      const text = `${'word '.repeat(13_000)}${capabilityToken}`;

      expect(redactString(text, 100_000)).not.toContain(
        capabilityToken.slice(0, 20),
      );
    });

    it('marks a circular reference and a repeated reference differently', () => {
      const shared = { a: 1 };
      const loop: Record<string, unknown> = { shared, again: shared };
      loop.self = loop;

      expect(redact(loop)).toEqual({
        shared: { a: 1 },
        again: { a: 1 },
        self: '[Circular]',
      });
    });
  });
});
