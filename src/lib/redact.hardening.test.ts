import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  isSensitiveKey,
  redact,
  redactString,
  REDACTED,
  TRUNCATED,
  UNREDACTABLE,
} from './redact';

const token = 'q7Hk2mVx9RtLw3NfZ8bYc1DsJ6aPe4UoG0iAhXnT5vE';

// The text Drizzle puts in a failed query's message: the statement, then the bound values.
const drizzleMessage =
  'Failed query: insert into "guests" ("full_name", "birth_date", "phone", "notes") values ($1, $2, $3, $4)\n' +
  'params: Ada Lovelace,1815-12-10,+1 212 555 0100,allergic to nuts\nand likes tea';

describe('database errors', () => {
  const secrets = [
    'Ada Lovelace',
    '1815-12-10',
    '555 0100',
    'allergic',
    'likes tea',
  ];

  it('cuts a Drizzle failed-query message at the bound values', () => {
    const out = redactString(drizzleMessage);

    for (const secret of secrets) expect(out).not.toContain(secret);
    expect(out).toContain('Failed query: insert into "guests"');
    expect(out).toContain('values ($1, $2, $3, $4)');
  });

  it('cuts a carriage-return variant too', () => {
    expect(
      redactString('Failed query: select 1\r\nparams: secret-value'),
    ).not.toContain('secret-value');
  });

  it('removes the values from the message, the stack, and every cause', () => {
    const inner = Object.assign(new Error('duplicate key value'), {
      detail: 'Key (email)=(ada@example.com) already exists.',
      where: 'COPY guests, line 1: "ada@example.com"',
    });
    const error = new Error(drizzleMessage, { cause: inner });
    error.stack = `Error: ${drizzleMessage}\n    at run (/app/db.ts:1:1)`;

    const out = JSON.stringify(redact(error));

    for (const secret of [...secrets, 'ada@example.com', 'COPY guests']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('duplicate key value');
  });

  it('does not copy the query and params fields of an error', () => {
    const error = Object.assign(new Error('Failed query: select 1'), {
      query: 'select * from guests where email = $1',
      params: ['ada@example.com'],
      parameters: ['ada@example.com'],
      detail: 'Key (email)=(ada@example.com)',
    });

    const out = redact(error) as Record<string, unknown>;

    expect(Object.keys(out)).not.toEqual(
      expect.arrayContaining(['query', 'params', 'parameters', 'detail']),
    );
    expect(JSON.stringify(out)).not.toContain('ada@example.com');
  });

  it.each([
    'detail',
    'parameters',
    'params',
    'query',
    'where',
    'sql',
    'statement',
    'internalQuery',
  ])(
    'treats %s as a sensitive field name, so a serialized database error cannot leak it',
    (key) => {
      expect(isSensitiveKey(key)).toBe(true);
      expect(
        redact({
          message: 'duplicate key',
          [key]: 'Key (email)=(ada@example.com)',
        }),
      ).toEqual({ message: 'duplicate key', [key]: REDACTED });
    },
  );

  it('keeps ordinary words that only mark a secret as a field name when they appear in text', () => {
    expect(redactString('Failed query: select 1 from guests')).toBe(
      'Failed query: select 1 from guests',
    );
    expect(redactString('job name: deliver_gift')).toBe(
      'job name: deliver_gift',
    );
  });

  it('removes the input Node quotes in a JSON parse error', () => {
    let message = '';
    try {
      JSON.parse('hunter2 and more private words');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('hunter2');
    expect(redactString(message)).not.toContain('hunter2');
  });

  it('keeps the input out of a Zod validation error', () => {
    const result = z
      .object({ email: z.email() })
      .safeParse({ email: 'not-an-email-hunter2' });

    expect(result.success).toBe(false);
    expect(JSON.stringify(redact(result.error))).not.toContain('hunter2');
  });
});

describe('work is bounded by the length that is kept', () => {
  const limit = 250;

  it.each([
    ['a JWT-shaped run', `${'-eyJab'.repeat(10_500)} !`],
    ['one long token run then a break', `${'a'.repeat(63_990)} ! `],
    ['repeated Bearer', 'Bearer '.repeat(9_000)],
    ['repeated @', 'a@'.repeat(32_000)],
    ['dotted labels with no TLD', `a@${'b.'.repeat(32_000)}`],
    ['digits with separators', '1 '.repeat(32_000)],
    ['query pairs', 'a=b&'.repeat(16_000)],
    ['secret pairs with no value', 'password='.repeat(7_000)],
    ['colons and spaces', ': '.repeat(32_000)],
    ['quotes', '"a'.repeat(32_000)],
    ['slashes after a capability prefix', `/manage/${'a/'.repeat(30_000)}`],
    ['cookie lines', 'cookie: \n'.repeat(7_000)],
    ['scheme prefixes', 'http://'.repeat(9_000)],
  ])('%s costs well under a second at 64k characters', (_name, input) => {
    const start = performance.now();

    redactString(input);

    expect(input.length).toBeGreaterThanOrEqual(60_000);
    expect(performance.now() - start).toBeLessThan(limit);
  });

  it('scans only a multiple of what it keeps, and marks the cut', () => {
    const out = redactString(`${'word '.repeat(5_000)}tail`);

    expect(out.endsWith(TRUNCATED)).toBe(true);
    expect(out).not.toContain('tail');
  });

  it('marks a cut even when redaction shrinks the text below the limit', () => {
    const out = redactString('a@b.co '.repeat(5_000));

    expect(out.endsWith(TRUNCATED)).toBe(true);
  });

  it('does not leave half a token where the scan is cut', () => {
    const maxLength = 100;
    const head = 'x '.repeat(190);
    const text = `${head}${token}`;
    expect(head.length + 20).toBe(maxLength * 4);

    expect(redactString(text, maxLength)).not.toContain(token.slice(0, 16));
  });
});

describe('redact never throws', () => {
  const hostile = (name: string) =>
    Object.defineProperty(new Error('visible'), name, {
      get() {
        throw new Error('getter');
      },
    });

  it.each(['name', 'message', 'stack', 'code', 'cause'])(
    'survives an error whose %s getter throws',
    (field) => {
      const out = JSON.stringify(redact(hostile(field)));

      expect(out).toContain(field === 'message' ? UNREDACTABLE : '"visible"');
    },
  );

  it('survives a Proxy that throws on every trap', () => {
    const proxy = new Proxy(
      {},
      new Proxy(
        {},
        {
          get() {
            throw new Error('trap');
          },
        },
      ),
    );

    expect(redact(proxy)).toBe(UNREDACTABLE);
    expect(redact({ ok: 1, bad: proxy })).toEqual({ ok: 1, bad: UNREDACTABLE });
  });

  it('survives a revoked Proxy', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(redact(proxy)).toBe(UNREDACTABLE);
    expect(redact([proxy, 'next'])).toEqual([UNREDACTABLE, 'next']);
  });

  it('survives an array whose index getter throws, keeping the other items', () => {
    const list = ['a', 'b', 'c'];
    Object.defineProperty(list, 1, {
      get() {
        throw new Error('index');
      },
    });

    expect(redact(list)).toEqual(['a', UNREDACTABLE, 'c']);
  });

  it('survives an array whose length throws', () => {
    const list = new Proxy([1, 2], {
      get(target, property, receiver) {
        if (property === 'length') throw new Error('length');
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    expect(() => redact(list)).not.toThrow();
  });

  it('survives an error whose cause chain is hostile', () => {
    const error = new Error('outer', { cause: hostile('message') });

    expect(() => redact(error)).not.toThrow();
  });
});

describe('numbers and boxed values', () => {
  it.each([
    ['a card number as a number', 4242424242424242],
    ['a negative one', -4242424242424242],
    ['an amex number as a number', 378282246310005],
  ])('redacts %s', (_name, value) => {
    expect(redact(value)).toBe('[redacted:card]');
    expect(redact({ n: value })).toEqual({ n: '[redacted:card]' });
  });

  it('redacts a card number as a bigint, and keeps other bigints', () => {
    expect(redact(4242424242424242n)).toBe('[redacted:card]');
    expect(redact(12n)).toBe('12');
  });

  it.each([
    ['a millisecond timestamp', 1_730_000_000_000],
    ['a small number', 42],
    ['a float', 3.5],
    ['a number that fails the checksum', 4242424242424241],
  ])('keeps %s', (_name, value) => {
    expect(redact(value)).toBe(value);
  });

  it('unwraps boxed strings, numbers, and bigints', () => {
    const boxed = [
      new String('mail a@b.co'),
      new Number(4242424242424242),
      Object(4242424242424242n),
    ];

    expect(redact(boxed)).toEqual([
      'mail [redacted:email]',
      '[redacted:card]',
      '[redacted:card]',
    ]);
  });
});

describe('names', () => {
  it.each([
    'name',
    'firstName',
    'lastName',
    'fullName',
    'guestName',
    'first_name',
  ])('redacts the value of %s', (key) => {
    expect(redact({ [key]: 'Ada Lovelace' })).toEqual({ [key]: REDACTED });
  });

  it('still reports the name of an error', () => {
    expect((redact(new TypeError('x')) as { name: string }).name).toBe(
      'TypeError',
    );
  });
});

describe('secrets in running text', () => {
  it.each([
    [
      'password=',
      'login failed password=hunter2 for user',
      'login failed password=[redacted] for user',
    ],
    ['token=', 'retry token=abc123 later', 'retry token=[redacted] later'],
    [
      'access_token=',
      'url access_token=abc.def.ghi next',
      'url access_token=[redacted] next',
    ],
    ['a colon pair', 'api_key: sk-abc123', 'api_key: [redacted]'],
    [
      'a quoted JSON pair',
      '{"password":"hunter2","a":1}',
      '{"password":[redacted],"a":1}',
    ],
    ['a Cookie header', 'Cookie: sid=abc; theme=dark', 'Cookie: [redacted]'],
    [
      'a Set-Cookie header',
      'Set-Cookie: sid=abc; HttpOnly',
      'Set-Cookie: [redacted]',
    ],
  ])('redacts %s', (_name, input, expected) => {
    const out = redactString(input);

    expect(out).toBe(expected);
    expect(out).not.toMatch(/hunter2|abc123|abc\.def|sk-abc|sid=abc/);
  });

  it.each([
    ['spaces', '4242 4242 4242 4242'],
    ['dots', '4242.4242.4242.4242'],
    ['slashes', '4242/4242/4242/4242'],
    ['hyphens', '4242-4242-4242-4242'],
    ['mixed', '4242 4242-4242.4242'],
  ])('redacts a card number with %s', (_name, card) => {
    expect(redactString(`paid with ${card} today`)).toBe(
      'paid with [redacted:card] today',
    );
  });

  it.each([
    [
      'a percent-encoded address',
      'next=guest%40example.com&x=1',
      'next=[redacted:email]&x=1',
    ],
    [
      'a lowercase encoded address',
      'to guest%40example.co.uk now',
      'to [redacted:email] now',
    ],
  ])('redacts %s', (_name, input, expected) => {
    expect(redactString(input)).toBe(expected);
  });

  it('is unchanged by being redacted twice', () => {
    const once = redactString(
      'password=hunter2 Cookie: a=b guest%40example.com 4242.4242.4242.4242',
    );

    expect(redactString(once)).toBe(once);
  });
});

describe('route patterns', () => {
  it.each([
    '/manage/[token]',
    '/orders/[reference]',
    '/gift/[token]',
    '/manage/[...rest]',
  ])('keeps the placeholder in %s', (route) => {
    expect(redactString(route)).toBe(route);
    expect(redact({ route })).toEqual({ route });
  });

  it.each([
    ['/manage/abc123', `/manage/${REDACTED}`],
    ['/orders/R-1234', `/orders/${REDACTED}`],
  ])('still redacts a real value: %s', (input, expected) => {
    expect(redactString(input)).toBe(expected);
  });
});
