import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  client,
  consent,
  consentRows,
  eraseDirectly,
  erase,
  newEmail,
  newGuest,
  ops,
  raceAgainstOpenTransaction,
  request,
  requestRows,
  rows,
  store,
  openGuestsDatabase,
} from './guestsFixtures';

// Behaviours under test, one per decision, branch or risk. The rest of the guests behaviours are in
// guests-constraints.db.test.ts and guests-functions.db.test.ts.
// - findOrCreateGuest: 20 parallel calls make one guest, and a call that meets an erasure in flight waits
//   and makes a new guest for the freed address
// - recordConsent: 20 parallel grants write one row, and an erasure committed while it waited refuses it
// - recordPrivacyRequest: 10 parallel calls write one row, and an erasure committed while it waited
//   refuses it
// - anonymizeGuest: 8 parallel calls erase once, and a consent committed while it waited is withdrawn

openGuestsDatabase();

describe('findOrCreateGuest', () => {
  it('makes one guest for 20 parallel calls on one address', async () => {
    const email = newEmail();

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        client.db.transaction((tx) => store.findOrCreateGuest(tx, email)),
      ),
    );

    const ids = new Set(
      results.map((result) =>
        result.status === 'ok' ? result.guest.id : 'refused',
      ),
    );
    expect(ids.size).toBe(1);
    expect(ids.has('refused')).toBe(false);
    expect(
      await rows(sql`SELECT 1 FROM guests WHERE email = ${email}`),
    ).toHaveLength(1);
  });

  it('waits for an erasure in flight, then makes a new guest for the freed address', async () => {
    const email = newEmail();
    const old = await newGuest(email);

    const result = await raceAgainstOpenTransaction(
      (tx) => eraseDirectly(tx, old.id),
      () => client.db.transaction((tx) => store.findOrCreateGuest(tx, email)),
    );

    if (result.status !== 'ok') throw new Error('refused');
    expect(result.guest.id).not.toBe(old.id);
    expect(result.guest.email).toBe(email);
    const [stored] = await rows<{ anonymized_at: Date | null }>(
      sql`SELECT anonymized_at FROM guests WHERE id = ${old.id}`,
    );
    expect(stored?.anonymized_at).not.toBeNull();
  });
});

describe('recordConsent', () => {
  it('writes one row for 20 parallel identical grants', async () => {
    const guest = await newGuest();

    const results = await Promise.all(
      Array.from({ length: 20 }, () => consent(guest.id)),
    );

    expect(results.filter(({ status }) => status === 'recorded')).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === 'unchanged')).toHaveLength(
      19,
    );
    expect(await consentRows(guest.id)).toHaveLength(1);
  });

  it('is refused by an erasure that committed while it waited', async () => {
    const guest = await newGuest();

    const result = await raceAgainstOpenTransaction(
      (tx) => eraseDirectly(tx, guest.id),
      () => consent(guest.id),
    );

    expect(result).toEqual({ status: 'guest_unavailable' });
    expect(await consentRows(guest.id)).toHaveLength(0);
  });
});

describe('recordPrivacyRequest', () => {
  it('writes one row for 10 parallel identical requests', async () => {
    const guest = await newGuest();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => request(guest.id)),
    );

    expect(results.filter(({ status }) => status === 'recorded')).toHaveLength(
      1,
    );
    expect(
      results.filter(({ status }) => status === 'already_open'),
    ).toHaveLength(9);
    expect(await requestRows(guest.id)).toHaveLength(1);
  });

  it('is refused by an erasure that committed while it waited', async () => {
    const guest = await newGuest();

    const result = await raceAgainstOpenTransaction(
      (tx) => eraseDirectly(tx, guest.id),
      () => request(guest.id),
    );

    expect(result).toEqual({ status: 'guest_unavailable' });
    expect(await requestRows(guest.id)).toHaveLength(0);
  });
});

describe('anonymizeGuest', () => {
  it('erases once for 8 parallel calls', async () => {
    const guest = await newGuest();
    await consent(guest.id, { kind: 'newsletter' });
    await consent(guest.id, { kind: 'attribution' });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => erase.anonymizeGuest(ops, guest.id)),
    );

    expect(
      results.filter(({ status }) => status === 'anonymized'),
    ).toHaveLength(1);
    expect(
      results.filter(({ status }) => status === 'already_anonymized'),
    ).toHaveLength(7);
    const erasures = (await consentRows(guest.id)).filter(
      ({ source }) => source === 'erasure',
    );
    expect(erasures).toHaveLength(2);
  });

  it('withdraws a consent that committed while it waited for the guest lock', async () => {
    const guest = await newGuest();

    const result = await raceAgainstOpenTransaction(
      async (tx) => {
        await store.recordConsent(tx, {
          guestId: guest.id,
          kind: 'newsletter',
          status: 'granted',
          source: 'checkout',
        });
      },
      () => erase.anonymizeGuest(ops, guest.id),
    );

    expect(result).toEqual({ status: 'anonymized' });
    expect(
      (await consentRows(guest.id)).map(({ status, source }) => [
        status,
        source,
      ]),
    ).toEqual([
      ['granted', 'checkout'],
      ['withdrawn', 'erasure'],
    ]);
  });
});
