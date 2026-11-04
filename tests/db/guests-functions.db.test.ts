import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { anonymizedEmail } from '@/lib/guests';
import { ForbiddenError, Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import {
  admin,
  client,
  consent,
  consentRows,
  guestCaller,
  newEmail,
  newGuest,
  ops,
  request,
  requestRows,
  rows,
  store,
  erase,
  openGuestsDatabase,
} from './guestsFixtures';

// Behaviours under test, one per decision, branch or risk. The races are in guests-races.db.test.ts.
// - findOrCreateGuest: one guest per address across spellings, a refused address writes nothing, a
//   rolled-back caller leaves nothing, times come from clock_timestamp
// - recordConsent: records with source and time, a repeat writes nothing, kinds are independent, bad
//   input and a missing or erased guest write nothing
// - recordPrivacyRequest: ops and admin only, one open request per kind, a new one after resolution, a
//   missing or erased guest refused
// - anonymizeGuest: ops and admin only, a missing or malformed id is not_found, the address is replaced and
//   freed, granted consents are withdrawn once and withdrawn ones left, requests are kept, a second
//   call changes nothing, a failing step rolls everything back

openGuestsDatabase();

/** The database's own clock as milliseconds, read through `reader`, which is the client or an open transaction. */
async function databaseMillis(
  reader: { execute: typeof client.db.execute },
  clock: ReturnType<typeof sql>,
) {
  const { rows: found } = await reader.execute<{ ms: number }>(
    sql`SELECT (extract(epoch FROM ${clock}) * 1000)::float8 AS ms`,
  );
  return found[0]?.ms ?? Number.NaN;
}

describe('findOrCreateGuest', () => {
  it('creates a guest and returns the same one for another spelling of the address', async () => {
    const first = await newGuest('Pat.Case@Example.com');
    const second = await newGuest('pat.case@example.com');

    expect(first.email).toBe('pat.case@example.com');
    expect(second.id).toBe(first.id);
    expect(first.anonymizedAt).toBeNull();
  });

  it('refuses an address the schema refuses and writes nothing', async () => {
    const result = await client.db.transaction((tx) =>
      store.findOrCreateGuest(tx, 'not an email'),
    );

    expect(result).toEqual({ status: 'invalid_email' });
    expect(
      await rows(sql`SELECT 1 FROM guests WHERE email = 'not an email'`),
    ).toHaveLength(0);
  });

  it('refuses the reserved erased-guest domain', async () => {
    const result = await client.db.transaction((tx) =>
      store.findOrCreateGuest(tx, 'pat@anonymized.invalid'),
    );

    expect(result).toEqual({ status: 'invalid_email' });
  });

  it('leaves no guest when the calling transaction rolls back', async () => {
    const email = newEmail();

    await expect(
      client.db.transaction(async (tx) => {
        await store.findOrCreateGuest(tx, email);
        throw new Error('checkout failed after the guest was written');
      }),
    ).rejects.toThrow('checkout failed');

    expect(
      await rows(sql`SELECT 1 FROM guests WHERE email = ${email}`),
    ).toHaveLength(0);
  });

  it('stamps the created time with clock_timestamp, not the transaction start', async () => {
    const result = await client.db.transaction(async (tx) => {
      const started = await databaseMillis(tx, sql`now()`);
      await tx.execute(sql`SELECT pg_sleep(0.15)`);
      const created = await store.findOrCreateGuest(tx, newEmail());
      return { started, created };
    });

    if (result.created.status !== 'ok') throw new Error('refused');
    expect(
      result.created.guest.createdAt.getTime() - result.started,
    ).toBeGreaterThanOrEqual(100);
  });
});

describe('recordConsent', () => {
  it('records a grant with its source and a time from the database clock', async () => {
    const guest = await newGuest();
    const before = await databaseMillis(client.db, sql`clock_timestamp()`);

    const result = await consent(guest.id);
    const after = await databaseMillis(client.db, sql`clock_timestamp()`);

    if (result.status !== 'recorded') throw new Error(result.status);
    expect(result.consent).toMatchObject({
      guestId: guest.id,
      kind: 'newsletter',
      status: 'granted',
      source: 'checkout',
    });
    expect(result.consent.recordedAt.getTime()).toBeGreaterThanOrEqual(
      Math.floor(before),
    );
    expect(result.consent.recordedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('stamps the recorded time with clock_timestamp, not the transaction start', async () => {
    const guest = await newGuest();

    const { started, recorded } = await client.db.transaction(async (tx) => {
      const now = await databaseMillis(tx, sql`now()`);
      await tx.execute(sql`SELECT pg_sleep(0.15)`);
      const result = await store.recordConsent(tx, {
        guestId: guest.id,
        kind: 'newsletter',
        status: 'granted',
        source: 'checkout',
      });
      return { started: now, recorded: result };
    });

    if (recorded.status !== 'recorded') throw new Error(recorded.status);
    expect(
      recorded.consent.recordedAt.getTime() - started,
    ).toBeGreaterThanOrEqual(100);
  });

  it('writes nothing for a repeat of the latest status, so the first grant keeps its time and source', async () => {
    const guest = await newGuest();
    await consent(guest.id, { source: 'ops' });

    const again = await consent(guest.id, { source: 'checkout' });

    expect(again).toEqual({ status: 'unchanged' });
    const stored = await consentRows(guest.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.source).toBe('ops');
  });

  it('records a withdrawal after a grant, and a grant after a withdrawal', async () => {
    const guest = await newGuest();

    await consent(guest.id);
    const withdrawn = await consent(guest.id, {
      status: 'withdrawn',
      source: 'unsubscribe',
    });
    const regranted = await consent(guest.id);

    expect(withdrawn.status).toBe('recorded');
    expect(regranted.status).toBe('recorded');
    expect((await consentRows(guest.id)).map((row) => row.status)).toEqual([
      'granted',
      'withdrawn',
      'granted',
    ]);
  });

  it('records a first withdrawal with nothing before it', async () => {
    const guest = await newGuest();

    const result = await consent(guest.id, {
      status: 'withdrawn',
      source: 'unsubscribe',
    });

    expect(result.status).toBe('recorded');
  });

  it('keeps the kinds apart', async () => {
    const guest = await newGuest();
    await consent(guest.id, { kind: 'newsletter' });

    const result = await consent(guest.id, { kind: 'attribution' });

    expect(result.status).toBe('recorded');
  });

  it.each([
    ['an unknown kind', { kind: 'sms' }],
    ['a source that cannot record the status', { status: 'withdrawn' }],
    ['a guest id that is not a uuid', { guestId: 'pat' }],
  ])('refuses %s and writes nothing', async (_name, overrides) => {
    const guest = await newGuest();

    const result = await consent(guest.id, overrides);

    expect(result).toEqual({ status: 'invalid' });
    expect(await consentRows(guest.id)).toHaveLength(0);
  });

  it('answers guest_unavailable for a guest that does not exist', async () => {
    expect(await consent('3e1c3a40-0000-4000-8000-0000000000cc')).toEqual({
      status: 'guest_unavailable',
    });
  });

  it('answers guest_unavailable for an erased guest and writes nothing', async () => {
    const guest = await newGuest();
    await erase.anonymizeGuest(ops, guest.id);
    const before = await consentRows(guest.id);

    const result = await consent(guest.id);

    expect(result).toEqual({ status: 'guest_unavailable' });
    expect(await consentRows(guest.id)).toEqual(before);
  });
});

describe('recordPrivacyRequest', () => {
  it.each([
    ['a guest', guestCaller],
    ['nobody', testCaller({ userId: null, roles: [] })],
    ['a host owner', testCaller({ roles: [Role.HostOwner], hostIds: ['h'] })],
  ])('refuses %s and writes nothing', async (_name, caller) => {
    const guest = await newGuest();

    await expect(request(guest.id, 'deletion', caller)).rejects.toThrow(
      ForbiddenError,
    );
    expect(await requestRows(guest.id)).toHaveLength(0);
  });

  it.each([
    ['ops', ops],
    ['admin', admin],
  ])('lets %s record a request', async (_name, caller) => {
    const guest = await newGuest();

    const result = await request(guest.id, 'access', caller);

    if (result.status !== 'recorded') throw new Error(result.status);
    expect(result.request).toMatchObject({
      guestId: guest.id,
      kind: 'access',
      status: 'open',
      resolvedAt: null,
    });
  });

  it('keeps one open request per kind and returns it when asked again', async () => {
    const guest = await newGuest();
    const first = await request(guest.id, 'deletion');

    const again = await request(guest.id, 'deletion');
    const other = await request(guest.id, 'access');

    if (first.status !== 'recorded' || again.status !== 'already_open') {
      throw new Error('unexpected status');
    }
    expect(again.request.id).toBe(first.request.id);
    expect(other.status).toBe('recorded');
    expect(await requestRows(guest.id)).toHaveLength(2);
  });

  it('records a new request once the earlier one is resolved', async () => {
    const guest = await newGuest();
    await request(guest.id, 'deletion');
    await client.db.execute(
      sql`UPDATE privacy_requests SET status = 'completed', resolved_at = clock_timestamp() WHERE guest_id = ${guest.id}`,
    );

    const result = await request(guest.id, 'deletion');

    expect(result.status).toBe('recorded');
    expect(await requestRows(guest.id)).toHaveLength(2);
  });

  it.each([
    ['an unknown kind', { kind: 'rectification' }],
    ['no kind', {}],
    ['an extra field', { kind: 'access', status: 'completed' }],
  ])('refuses %s and writes nothing', async (_name, fields) => {
    const guest = await newGuest();

    const result = await store.recordPrivacyRequest(ops, {
      guestId: guest.id,
      ...fields,
    });

    expect(result).toEqual({ status: 'invalid' });
    expect(await requestRows(guest.id)).toHaveLength(0);
  });

  it('answers guest_unavailable for a missing guest and for an erased one', async () => {
    const erased = await newGuest();
    await erase.anonymizeGuest(ops, erased.id);

    expect(await request('3e1c3a40-0000-4000-8000-0000000000dd')).toEqual({
      status: 'guest_unavailable',
    });
    expect(await request(erased.id)).toEqual({ status: 'guest_unavailable' });
    expect(await requestRows(erased.id)).toHaveLength(0);
  });
});

describe('anonymizeGuest', () => {
  const guestRow = async (id: string) => {
    const [row] = await rows<{ email: string; anonymized_at: Date | null }>(
      sql`SELECT email, anonymized_at FROM guests WHERE id = ${id}`,
    );
    return row;
  };

  it.each([
    ['a guest', guestCaller],
    ['nobody', testCaller({ userId: null, roles: [] })],
  ])('refuses %s and changes nothing', async (_name, caller) => {
    const guest = await newGuest();

    await expect(erase.anonymizeGuest(caller, guest.id)).rejects.toThrow(
      ForbiddenError,
    );
    expect((await guestRow(guest.id))?.email).toBe(guest.email);
  });

  it.each([
    ['ops', ops],
    ['admin', admin],
  ])('lets %s erase a guest', async (_name, caller) => {
    const guest = await newGuest();

    expect(await erase.anonymizeGuest(caller, guest.id)).toEqual({
      status: 'anonymized',
    });
  });

  it.each([
    ['an id nobody has', '3e1c3a40-0000-4000-8000-0000000000ee'],
    ['something that is not an id', 'pat@example.com'],
    ['an empty id', ''],
  ])('answers not_found for %s', async (_name, id) => {
    expect(await erase.anonymizeGuest(ops, id)).toEqual({
      status: 'not_found',
    });
  });

  it('replaces the address with one derived from the id, stamps the time, and frees the address', async () => {
    const guest = await newGuest();

    await erase.anonymizeGuest(ops, guest.id);

    const row = await guestRow(guest.id);
    expect(row?.email).toBe(anonymizedEmail(guest.id));
    expect(row?.anonymized_at).not.toBeNull();
    const returning = await newGuest(guest.email);
    expect(returning.id).not.toBe(guest.id);
  });

  it('accepts the id in capitals', async () => {
    const guest = await newGuest();

    expect(await erase.anonymizeGuest(ops, guest.id.toUpperCase())).toEqual({
      status: 'anonymized',
    });
  });

  it('withdraws each consent still granted, once, and leaves a withdrawn kind alone', async () => {
    const guest = await newGuest();
    await consent(guest.id, { kind: 'newsletter' });
    await consent(guest.id, { kind: 'attribution' });
    await consent(guest.id, {
      kind: 'attribution',
      status: 'withdrawn',
      source: 'unsubscribe',
    });

    await erase.anonymizeGuest(ops, guest.id);

    const stored = await consentRows(guest.id);
    expect(
      stored.map(({ kind, status, source }) => [kind, status, source]),
    ).toEqual([
      ['newsletter', 'granted', 'checkout'],
      ['attribution', 'granted', 'checkout'],
      ['attribution', 'withdrawn', 'unsubscribe'],
      ['newsletter', 'withdrawn', 'erasure'],
    ]);
  });

  it('writes no consent row for a guest with none', async () => {
    const guest = await newGuest();

    await erase.anonymizeGuest(ops, guest.id);

    expect(await consentRows(guest.id)).toHaveLength(0);
  });

  it('keeps the guest’s privacy requests, now pointing at an erased guest', async () => {
    const guest = await newGuest();
    await store.recordPrivacyRequest(ops, {
      guestId: guest.id,
      kind: 'deletion',
    });

    await erase.anonymizeGuest(ops, guest.id);

    const stored = await rows(
      sql`SELECT 1 FROM privacy_requests WHERE guest_id = ${guest.id}`,
    );
    expect(stored).toHaveLength(1);
  });

  it('changes nothing the second time', async () => {
    const guest = await newGuest();
    await consent(guest.id);
    await erase.anonymizeGuest(ops, guest.id);
    const guestBefore = await guestRow(guest.id);
    const consentsBefore = await consentRows(guest.id);

    const again = await erase.anonymizeGuest(ops, guest.id);

    expect(again).toEqual({ status: 'already_anonymized' });
    expect(await guestRow(guest.id)).toEqual(guestBefore);
    expect(await consentRows(guest.id)).toEqual(consentsBefore);
  });

  it('rolls everything back when a step fails', async () => {
    const guest = await newGuest();
    await consent(guest.id);
    await client.db.execute(sql`
      CREATE FUNCTION refuse_erasure_rows() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'erasure rows refused'; END $$`);
    await client.db.execute(sql`
      CREATE TRIGGER refuse_erasure_rows BEFORE INSERT ON consents
      FOR EACH ROW WHEN (NEW.source = 'erasure') EXECUTE FUNCTION refuse_erasure_rows()`);

    try {
      await expect(erase.anonymizeGuest(ops, guest.id)).rejects.toThrow();
    } finally {
      await client.db.execute(
        sql`DROP TRIGGER refuse_erasure_rows ON consents`,
      );
      await client.db.execute(sql`DROP FUNCTION refuse_erasure_rows()`);
    }

    expect((await guestRow(guest.id))?.email).toBe(guest.email);
    expect((await guestRow(guest.id))?.anonymized_at).toBeNull();
    expect(await consentRows(guest.id)).toHaveLength(1);
  });
});
