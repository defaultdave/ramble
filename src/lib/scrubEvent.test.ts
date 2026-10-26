import { describe, expect, it } from 'vitest';
import { scrubBreadcrumb, scrubEvent } from './scrubEvent';

const token = 'q7Hk2mVx9RtLw3NfZ8bYc1DsJ6aPe4UoG0iAhXnT5vE';

function sampleEvent() {
  return {
    event_id: 'fc6d8c0c43fc4630ad850ee518f1b9d0',
    timestamp: 1_761_350_400.5,
    platform: 'node',
    level: 'error',
    message: `Could not email a@b.co about ${token}`,
    transaction: `GET /manage/${token}`,
    fingerprint: ['payment-mismatch', 'order:ord_1'],
    user: {
      id: 'u_1',
      email: 'a@b.co',
      ip_address: '1.2.3.4',
      username: 'Ann',
    },
    request: {
      url: `https://ramble.example/manage/${token}?token=x`,
      method: 'POST',
      headers: {
        cookie: 'sid=1',
        'user-agent': 'jest',
        authorization: 'Bearer abcdefgh12345',
      },
      cookies: { sid: 'abc' },
      data: { email: 'a@b.co', card: '4242424242424242' },
      query_string: `token=${token}&page=2`,
    },
    exception: {
      values: [
        {
          type: 'Error',
          value: 'failed for 4242 4242 4242 4242',
          mechanism: {
            type: 'generic',
            handled: true,
            data: { who: 'a@b.co' },
          },
          stacktrace: {
            frames: [
              {
                filename:
                  'app:///src/server/getExperienceCatalogBySlugFromCache.ts',
                function:
                  'getExperienceCatalogBySlugFromCacheWithTagsAndLifetime',
                lineno: 12,
                vars: { password: 'hunter2', note: 'a@b.co' },
              },
            ],
          },
        },
      ],
    },
    extra: { order: { guestEmail: 'a@b.co', note: `see ${token}` } },
    tags: {
      request_id: 'iad1::iad1::abcde-1730000000000-0123456789ab',
      kind: 'x',
      who: 'a@b.co',
    },
    contexts: {
      trace: {
        trace_id: 'fc6d8c0c43fc4630ad850ee518f1b9d0',
        span_id: 'ab12cd34ef56ab12',
      },
      runtime: { name: 'node', version: 'v24.0.0' },
      details: { token, email: 'a@b.co', note: `mail a@b.co` },
    },
    breadcrumbs: [
      {
        category: 'fetch',
        message: 'POST to a@b.co',
        data: { url: `https://x.example/gift/${token}`, status_code: 200 },
      },
    ],
    sdk: { name: 'sentry.javascript.nextjs', version: '11.9.0' },
    sdkProcessingMetadata: {
      capturedSpanScope: { marker: 'kept by reference' },
    },
  };
}

describe('scrubEvent', () => {
  it('leaves no secret anywhere in the serialized event', () => {
    const out = JSON.stringify(scrubEvent(sampleEvent()));

    for (const secret of [
      token,
      'a@b.co',
      '4242424242424242',
      '4242 4242 4242 4242',
      'hunter2',
      '1.2.3.4',
      'Ann',
      'sid=1',
      'abcdefgh12345',
    ]) {
      expect(out).not.toContain(secret);
    }
  });

  it('keeps what the SDK and the developer need to read the report', () => {
    const out = scrubEvent(sampleEvent());

    expect(out.event_id).toBe('fc6d8c0c43fc4630ad850ee518f1b9d0');
    expect(out.timestamp).toBe(1_761_350_400.5);
    expect(out.level).toBe('error');
    expect(out.contexts.trace.trace_id).toBe(
      'fc6d8c0c43fc4630ad850ee518f1b9d0',
    );
    expect(out.contexts.runtime).toEqual({ name: 'node', version: 'v24.0.0' });
    expect(out.tags.request_id).toBe(
      'iad1::iad1::abcde-1730000000000-0123456789ab',
    );
    expect(out.tags.kind).toBe('x');
    expect(out.fingerprint).toEqual(['payment-mismatch', 'order:ord_1']);
    expect(out.request.method).toBe('POST');
    const [frame] = out.exception.values[0]?.stacktrace.frames ?? [];
    expect(frame).toMatchObject({
      function: 'getExperienceCatalogBySlugFromCacheWithTagsAndLifetime',
      lineno: 12,
    });
  });

  it('drops request cookies and bodies, and local variables in stack frames', () => {
    const out = scrubEvent(sampleEvent());

    expect(out.request).not.toHaveProperty('cookies');
    expect(out.request).not.toHaveProperty('data');
    expect(out.exception.values[0]?.stacktrace.frames[0]).not.toHaveProperty(
      'vars',
    );
  });

  it('reduces the user to an opaque ID', () => {
    expect(scrubEvent(sampleEvent()).user).toEqual({ id: 'u_1' });
    expect(scrubEvent({ user: { email: 'a@b.co' } }).user).toEqual({
      id: '[redacted]',
    });
  });

  it('hands the SDK back its own processing metadata untouched', () => {
    const event = sampleEvent();

    expect(scrubEvent(event).sdkProcessingMetadata).toBe(
      event.sdkProcessingMetadata,
    );
  });

  it('scrubs a message event with logentry parameters', () => {
    const out = scrubEvent({
      logentry: { message: 'sent to %s', params: ['a@b.co'] },
    });

    expect(JSON.stringify(out)).not.toContain('a@b.co');
  });

  it('does not change the event it is given', () => {
    const event = sampleEvent();
    const before = JSON.stringify(event);

    scrubEvent(event);

    expect(JSON.stringify(event)).toBe(before);
  });

  it('copes with sections that are missing or the wrong type', () => {
    expect(scrubEvent({})).toEqual({});
    expect(
      scrubEvent({
        exception: 'odd',
        request: 3,
        user: null,
        contexts: [],
        breadcrumbs: 'x',
      }),
    ).toEqual({
      exception: 'odd',
      request: 3,
      user: null,
      contexts: [],
      breadcrumbs: 'x',
    });
  });

  it('keeps at most 200 breadcrumbs and frames', () => {
    const out = scrubEvent({
      breadcrumbs: Array.from({ length: 500 }, () => ({ message: 'm' })),
    });

    expect(out.breadcrumbs).toHaveLength(200);
  });
});

describe('scrubEvent and the fingerprint', () => {
  it('passes the fingerprint through untouched, so unrelated alerts do not merge', () => {
    const a = 'a1'.repeat(32);
    const b = 'b2'.repeat(32);

    expect(scrubEvent({ fingerprint: ['kind', a] }).fingerprint).toEqual([
      'kind',
      a,
    ]);
    expect(scrubEvent({ fingerprint: ['kind', b] }).fingerprint).toEqual([
      'kind',
      b,
    ]);
  });
});

describe('scrubBreadcrumb', () => {
  it('redacts the message and data of one breadcrumb', () => {
    const out = scrubBreadcrumb({
      category: 'http',
      message: 'GET /manage/' + token,
      data: { url: `/gift/${token}`, email: 'a@b.co' },
    });

    expect(JSON.stringify(out)).not.toContain(token);
    expect(JSON.stringify(out)).not.toContain('a@b.co');
    expect(out.category).toBe('http');
  });
});
