import { beforeEach, describe, expect, it } from 'vitest';
import { maxObjectBytes, maxSignedUrlSeconds } from '@/lib/storage';
import {
  StorageError,
  type StorageErrorCode,
  type StoragePort,
} from '@/server/ports/storage';

export type StorageContractHarness = {
  port: StoragePort;
  /** Whether a signed link opens right now. The fake checks its own signature; a real store is fetched. */
  opens(signedUrl: string): Promise<boolean>;
  /** Moves the adapter's clock forward, so the suite can see a link expire. */
  advanceSeconds(seconds: number): void;
};

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const pdf = new TextEncoder().encode('%PDF-1.7 fake');

let counter = 0;
function newId() {
  counter += 1;
  return `obj-${String(counter)}`;
}

async function rejectsWith(promise: Promise<unknown>, code: StorageErrorCode) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(StorageError);
  expect((error as StorageError).code).toBe(code);
}

/**
 * Behaviours every storage adapter keeps. The fake and the Vercel Blob adapter (over a stand-in for
 * its SDK, because tests never call the network) run the same suite.
 */
export function describeStoragePortContract(
  name: string,
  makeHarness: () => StorageContractHarness,
) {
  describe(`${name} storage contract`, () => {
    let harness: StorageContractHarness;
    let port: StoragePort;

    beforeEach(() => {
      harness = makeHarness();
      port = harness.port;
    });

    describe('put', () => {
      it('stores a public object and returns its address', async () => {
        const key = `public/photos/${newId()}.jpg`;

        const stored = await port.put({
          key,
          body: jpeg,
          contentType: 'image/jpeg',
        });

        expect(stored).toMatchObject({
          key,
          visibility: 'public',
          size: jpeg.byteLength,
          contentType: 'image/jpeg',
        });
        expect(stored.url).toContain(key);
      });

      it('stores a private object and returns no address', async () => {
        const stored = await port.put({
          key: `private/documents/${newId()}.pdf`,
          body: pdf,
          contentType: 'application/pdf',
        });

        expect(stored.visibility).toBe('private');
        expect(stored.url).toBeNull();
      });

      it('refuses to overwrite a key', async () => {
        const key = `public/photos/${newId()}.jpg`;
        await port.put({ key, body: jpeg, contentType: 'image/jpeg' });

        await rejectsWith(
          port.put({ key, body: jpeg, contentType: 'image/jpeg' }),
          'already_exists',
        );
      });

      it.each([
        ['no visibility prefix', 'photos/a.jpg'],
        ['an unknown prefix', 'shared/a.jpg'],
        ['a parent segment', 'public/photos/../private/a.jpg'],
        ['an empty segment', 'public//a.jpg'],
        ['a leading dot segment', 'public/.hidden/a.jpg'],
        ['upper case', 'public/Photos/A.jpg'],
        ['a space', 'public/photos/a b.jpg'],
        ['a trailing slash', 'public/photos/'],
        ['a query string', 'public/photos/a.jpg?x=1'],
        ['too many characters', `public/${'a'.repeat(200)}.jpg`],
      ])('refuses a key with %s', async (_label, key) => {
        await rejectsWith(
          port.put({ key, body: jpeg, contentType: 'image/jpeg' }),
          'invalid_input',
        );
      });

      it.each([
        ['a pdf under public/', 'public/photos/a.pdf', 'application/pdf'],
        ['a script under public/', 'public/photos/a.js', 'text/javascript'],
        ['a webp under private/', 'private/documents/a.webp', 'image/webp'],
        ['an svg under public/', 'public/photos/a.svg', 'image/svg+xml'],
      ])('refuses %s', async (_label, key, contentType) => {
        await rejectsWith(
          port.put({ key, body: jpeg, contentType }),
          'invalid_input',
        );
      });

      it.each([
        ['an empty body', new Uint8Array(0)],
        ['a body over the limit', new Uint8Array(maxObjectBytes + 1)],
      ])('refuses %s', async (_label, body) => {
        await rejectsWith(
          port.put({
            key: `public/photos/${newId()}.jpg`,
            body,
            contentType: 'image/jpeg',
          }),
          'invalid_input',
        );
      });
    });

    describe('getSignedUrl', () => {
      async function putPrivate() {
        const key = `private/documents/${newId()}.pdf`;
        await port.put({ key, body: pdf, contentType: 'application/pdf' });
        return key;
      }

      it('opens a private object until it expires', async () => {
        const key = await putPrivate();

        const url = await port.getSignedUrl({ key, expiresInSeconds: 60 });

        expect(await harness.opens(url)).toBe(true);
        harness.advanceSeconds(59);
        expect(await harness.opens(url)).toBe(true);
        harness.advanceSeconds(2);
        expect(await harness.opens(url)).toBe(false);
      });

      it('lasts the default time when none is given', async () => {
        const url = await port.getSignedUrl({ key: await putPrivate() });

        harness.advanceSeconds(290);
        expect(await harness.opens(url)).toBe(true);
        harness.advanceSeconds(20);
        expect(await harness.opens(url)).toBe(false);
      });

      it('is not the address of the object', async () => {
        const key = await putPrivate();

        const url = await port.getSignedUrl({ key });

        expect(url).not.toBe(`https://${key}`);
        expect(url).toMatch(/[?&]/);
      });

      it('refuses a public key, which has an address of its own', async () => {
        const key = `public/photos/${newId()}.jpg`;
        await port.put({ key, body: jpeg, contentType: 'image/jpeg' });

        await rejectsWith(port.getSignedUrl({ key }), 'invalid_input');
      });

      it.each([0, -1, 1.5, maxSignedUrlSeconds + 1])(
        'refuses %s seconds',
        async (expiresInSeconds) => {
          await rejectsWith(
            port.getSignedUrl({
              key: await putPrivate(),
              expiresInSeconds,
            }),
            'invalid_input',
          );
        },
      );

      it('says not_found for a key that holds nothing', async () => {
        await rejectsWith(
          port.getSignedUrl({ key: `private/documents/${newId()}.pdf` }),
          'not_found',
        );
      });
    });

    describe('delete', () => {
      it('removes an object, so it can be stored again and has no link', async () => {
        const key = `private/documents/${newId()}.pdf`;
        await port.put({ key, body: pdf, contentType: 'application/pdf' });

        await port.delete({ key });

        await rejectsWith(port.getSignedUrl({ key }), 'not_found');
        await expect(
          port.put({ key, body: pdf, contentType: 'application/pdf' }),
        ).resolves.toMatchObject({ key });
      });

      it('is not an error for a key that holds nothing', async () => {
        await expect(
          port.delete({ key: `public/photos/${newId()}.jpg` }),
        ).resolves.toBeUndefined();
      });

      it('refuses a malformed key', async () => {
        await rejectsWith(
          port.delete({ key: '../etc/passwd' }),
          'invalid_input',
        );
      });
    });
  });
}
