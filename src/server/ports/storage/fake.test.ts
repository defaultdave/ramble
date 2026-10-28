import { describe, expect, it } from 'vitest';
import { describeStoragePortContract } from '../../../../tests/contracts/storage-port';
import { createFakeStorageAdapter, createFakeStorageState } from './fake';

const start = new Date('2026-10-26T12:00:00.000Z');

function makeFake() {
  let current = start.getTime();
  const fake = createFakeStorageAdapter({ now: () => new Date(current) });
  return {
    fake,
    advanceSeconds: (seconds: number) => {
      current += seconds * 1000;
    },
  };
}

describeStoragePortContract('fake', () => {
  const { fake, advanceSeconds } = makeFake();
  return {
    port: fake,
    opens: (url) => Promise.resolve(fake.opens(url)),
    advanceSeconds,
  };
});

describe('fake storage adapter', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 1, 2]);

  it('keeps a copy of the body, so the caller changing its buffer cannot change the object', async () => {
    const { fake } = makeFake();
    const body = Uint8Array.from(jpeg);

    await fake.put({
      key: 'public/photos/a.jpg',
      body,
      contentType: 'image/jpeg',
    });
    body[0] = 0;

    expect(fake.read('public/photos/a.jpg')).toEqual(jpeg);
  });

  it('shares objects between adapters built over one state', async () => {
    const state = createFakeStorageState();
    const first = createFakeStorageAdapter({ now: () => start, state });
    const second = createFakeStorageAdapter({ now: () => start, state });

    await first.put({
      key: 'private/documents/a.pdf',
      body: jpeg,
      contentType: 'image/jpeg',
    });

    const url = await second.getSignedUrl({ key: 'private/documents/a.pdf' });
    expect(first.opens(url)).toBe(true);
  });

  it('does not open a link whose signature or expiry was changed', async () => {
    const { fake } = makeFake();
    await fake.put({
      key: 'private/documents/a.pdf',
      body: jpeg,
      contentType: 'image/jpeg',
    });
    const url = new URL(
      await fake.getSignedUrl({ key: 'private/documents/a.pdf' }),
    );

    const tamperedSignature = new URL(url);
    tamperedSignature.searchParams.set('signature', 'f'.repeat(64));
    const tamperedExpiry = new URL(url);
    tamperedExpiry.searchParams.set(
      'expires',
      String(Number(url.searchParams.get('expires')) + 3600),
    );

    expect(fake.opens(tamperedSignature.toString())).toBe(false);
    expect(fake.opens(tamperedExpiry.toString())).toBe(false);
  });
});
