import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { anonymizedEmail } from '@/lib/guests';
import { ForbiddenError, Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import {
  createFreshDatabase,
  raceAgainstOpenTransaction as race,
  type FreshDatabase,
} from './harness';

// Behaviours under test, one per decision, branch or risk.
// Constraints (each bad row is refused by the database, with the constraint named):
// - guests: email shape, case, length, uniqueness; the reserved domain only on erased rows; the erased
//   address derived from the row id; erased time not before created; times in range
// - consents: each source records only the statuses it may; the guest must exist and cannot be deleted;
//   enums; time in range
// - privacy requests: open exactly when unresolved; resolved not before created; one open per guest and kind
// Functions:
// - findOrCreateGuest: one guest per address across spellings, a refused address writes nothing, a
//   rolled-back caller leaves nothing, times come from clock_timestamp, 20 parallel calls make one guest,
//   and a call that meets an erasure in flight waits and makes a new guest for the freed address
// - recordConsent: records with source and time, a repeat writes nothing, kinds are independent, bad
//   input and a missing or erased guest write nothing, 20 parallel grants write one row, and an erasure
//   committed while it waited refuses it
// - recordPrivacyRequest: ops and admin only, one open request per kind, a new one after resolution, a
//   missing or erased guest refused, 10 parallel calls write one row, and an erasure committed while it
//   waited refuses it
// - anonymizeGuest: ops and admin only, a missing or malformed id is not_found, the address is replaced and
//   freed, granted consents are withdrawn once and withdrawn ones left, requests are kept, a second
//   call changes nothing, 8 parallel calls erase once, a failing step rolls everything back, and a consent
//   committed while it waited is withdrawn

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let store: typeof import('@/server/db/guests');
let erase: typeof import('@/server/db/anonymize');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  store = await import('@/server/db/guests');
  erase = await import('@/server/db/anonymize');
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

type Tx = Parameters<Parameters<typeof client.db.transaction>[0]>[0];

const ops = testCaller({ roles: [Role.Ops] });
const admin = testCaller({ roles: [Role.Admin] });
const guestCaller = testCaller();

let counter = 0;
function newEmail() {
  counter += 1;
  return `guest-${String(counter)}@example.com`;
}

function raceAgainstOpenTransaction<T>(
  holder: (tx: Tx) => Promise<void>,
  challenger: () => Promise<T>,
): Promise<T> {
  return race<Tx, T>((body) => client.db.transaction(body), holder, challenger);
}

async function newGuest(email = newEmail()) {
  const result = await client.db.transaction((tx) =>
    store.findOrCreateGuest(tx, email),
  );
  if (result.status !== 'ok') throw new Error('The test email was refused');
  return result.guest;
}

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

function consent(guestId: string, overrides: Record<string, string> = {}) {
  return client.db.transaction((tx) =>
    store.recordConsent(tx, {
      guestId,
      kind: 'newsletter',
      status: 'granted',
      source: 'checkout',
      ...overrides,
    }),
  );
}

async function rows<T extends Record<string, unknown>>(
  query: ReturnType<typeof sql>,
) {
  const { rows: found } = await client.db.execute<T>(query);
  return found;
}

const consentRows = (guestId: string) =>
  rows<{ kind: string; status: string; source: string; recorded_at: Date }>(
    sql`SELECT kind, status, source, recorded_at FROM consents WHERE guest_id = ${guestId} ORDER BY recorded_at, id`,
  );

async function eraseDirectly(tx: Tx, guestId: string) {
  await tx.execute(sql`SELECT id FROM guests WHERE id = ${guestId} FOR UPDATE`);
  await tx.execute(
    sql`UPDATE guests SET email = ${anonymizedEmail(guestId)}, anonymized_at = clock_timestamp() WHERE id = ${guestId}`,
  );
}

const constraint = (name: string) => ({ cause: { constraint: name } });

describe('guests constraints', () => {
  const insert = (email: string, extra = sql``) =>
    client.db.execute(
      sql`INSERT INTO guests (email) VALUES (${email}) ${extra}`,
    );

  it('accepts a well-formed row', async () => {
    const email = newEmail();
    await insert(email);

    const [stored] = await rows<{ email: string }>(
      sql`SELECT email FROM guests WHERE email = ${email}`,
    );
    expect(stored?.email).toBe(email);
  });

  it.each([
    ['blank', ''],
    ['no domain', 'pat@'],
    ['an upper-case address', 'Pat@example.com'],
    ['a display name', 'Pat <pat@example.com>'],
    ['a space', 'pat smith@example.com'],
    ['a trailing newline', 'pat@example.com\n'],
    ['a single-label domain', 'pat@localhost'],
    ['non-ASCII', 'pät@example.com'],
    ['255 characters', `${'a'.repeat(243)}@example.com`],
    ['an unbounded address', `${'a'.repeat(100_000)}@example.com`],
  ])('refuses an email that is %s', async (_name, email) => {
    await expect(insert(email)).rejects.toMatchObject(
      constraint('guests_email_shape'),
    );
  });

  it('refuses a second row for the same address', async () => {
    const email = newEmail();
    await insert(email);

    await expect(insert(email)).rejects.toMatchObject(
      constraint('guests_email_unique'),
    );
  });

  it('refuses the reserved domain on a live guest', async () => {
    await expect(insert('pat@anonymized.invalid')).rejects.toMatchObject(
      constraint('guests_reserved_domain_iff_anonymized'),
    );
  });

  it('refuses an erased row that keeps an ordinary address', async () => {
    await expect(
      client.db.execute(
        sql`INSERT INTO guests (email, anonymized_at) VALUES (${newEmail()}, clock_timestamp())`,
      ),
    ).rejects.toMatchObject(constraint('guests_anonymized_email_from_id'));
  });

  it('refuses an erased row whose address is not derived from its id', async () => {
    await expect(
      client.db.execute(
        sql`INSERT INTO guests (email, anonymized_at) VALUES ('erased-someone-else@anonymized.invalid', clock_timestamp())`,
      ),
    ).rejects.toMatchObject(constraint('guests_anonymized_email_from_id'));
  });

  it('refuses an erased time before the created time', async () => {
    const id = '3e1c3a40-0000-4000-8000-000000000001';
    await expect(
      client.db.execute(
        sql`INSERT INTO guests (id, email, created_at, anonymized_at) VALUES (${id}, ${anonymizedEmail(id)}, now(), now() - interval '1 day')`,
      ),
    ).rejects.toMatchObject(constraint('guests_anonymized_at_in_range'));
  });

  it.each([
    ['infinity', 'infinity'],
    ['a year past 9999', '10000-01-01 00:00:00+00'],
  ])('refuses a created time of %s', async (_name, value) => {
    await expect(
      client.db.execute(
        sql`INSERT INTO guests (email, created_at) VALUES (${newEmail()}, ${value}::timestamptz)`,
      ),
    ).rejects.toMatchObject(constraint('guests_created_at_in_range'));
  });

  it('refuses a null address', async () => {
    await expect(
      client.db.execute(sql`INSERT INTO guests (email) VALUES (NULL)`),
    ).rejects.toMatchObject({ cause: { code: '23502' } });
  });
});

describe('consents constraints', () => {
  const insert = (
    guestId: string,
    kind: string,
    status: string,
    source: string,
  ) =>
    client.db.execute(
      sql`INSERT INTO consents (guest_id, kind, status, source) VALUES (${guestId}, ${kind}, ${status}, ${source})`,
    );

  it.each([
    ['checkout', 'granted'],
    ['unsubscribe', 'withdrawn'],
    ['ops', 'granted'],
    ['ops', 'withdrawn'],
    ['erasure', 'withdrawn'],
  ])('accepts %s with %s', async (source, status) => {
    const guest = await newGuest();

    await insert(guest.id, 'newsletter', status, source);

    expect(await consentRows(guest.id)).toHaveLength(1);
  });

  it.each([
    ['checkout', 'withdrawn'],
    ['unsubscribe', 'granted'],
    ['erasure', 'granted'],
  ])('refuses %s with %s', async (source, status) => {
    const guest = await newGuest();

    await expect(
      insert(guest.id, 'newsletter', status, source),
    ).rejects.toMatchObject(constraint('consents_source_allows_status'));
  });

  it.each([
    ['kind', ['sms', 'granted', 'checkout']],
    ['status', ['newsletter', 'pending', 'checkout']],
    ['source', ['newsletter', 'granted', 'import']],
  ])('refuses an unknown %s', async (_name, [kind, status, source]) => {
    const guest = await newGuest();

    await expect(
      insert(guest.id, kind ?? '', status ?? '', source ?? ''),
    ).rejects.toMatchObject({ cause: { code: '22P02' } });
  });

  it('refuses a consent for a guest that does not exist', async () => {
    await expect(
      insert(
        '3e1c3a40-0000-4000-8000-0000000000aa',
        'newsletter',
        'granted',
        'checkout',
      ),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  it('refuses to delete a guest who has a consent', async () => {
    const guest = await newGuest();
    await consent(guest.id);

    await expect(
      client.db.execute(sql`DELETE FROM guests WHERE id = ${guest.id}`),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  it('refuses a null guest, kind, status, or source', async () => {
    const guest = await newGuest();
    for (const column of ['guest_id', 'kind', 'status', 'source']) {
      const values = {
        guest_id: guest.id,
        kind: 'newsletter',
        status: 'granted',
        source: 'checkout',
        [column]: null,
      };
      await expect(
        client.db.execute(
          sql`INSERT INTO consents (guest_id, kind, status, source) VALUES (${values.guest_id}, ${values.kind}, ${values.status}, ${values.source})`,
        ),
        column,
      ).rejects.toMatchObject({ cause: { code: '23502' } });
    }
  });

  it('refuses a recorded time of infinity', async () => {
    const guest = await newGuest();

    await expect(
      client.db.execute(
        sql`INSERT INTO consents (guest_id, kind, status, source, recorded_at) VALUES (${guest.id}, 'newsletter', 'granted', 'checkout', 'infinity')`,
      ),
    ).rejects.toMatchObject(constraint('consents_recorded_at_in_range'));
  });
});

describe('privacy_requests constraints', () => {
  const insert = (
    guestId: string,
    kind: string,
    status: string,
    resolved: 'resolved' | null,
  ) =>
    client.db.execute(
      sql`INSERT INTO privacy_requests (guest_id, kind, status, resolved_at) VALUES (${guestId}, ${kind}, ${status}, ${resolved === null ? sql`NULL` : sql`clock_timestamp()`})`,
    );

  it('accepts an open request with no resolved time and a completed one with it', async () => {
    const guest = await newGuest();

    await insert(guest.id, 'access', 'open', null);
    await insert(guest.id, 'access', 'completed', 'resolved');

    const stored = await rows(
      sql`SELECT 1 FROM privacy_requests WHERE guest_id = ${guest.id}`,
    );
    expect(stored).toHaveLength(2);
  });

  it('refuses an open request that has a resolved time', async () => {
    const guest = await newGuest();

    await expect(
      insert(guest.id, 'access', 'open', 'resolved'),
    ).rejects.toMatchObject(
      constraint('privacy_requests_resolved_iff_not_open'),
    );
  });

  it.each(['completed', 'declined'])(
    'refuses a %s request with no resolved time',
    async (status) => {
      const guest = await newGuest();

      await expect(
        insert(guest.id, 'access', status, null),
      ).rejects.toMatchObject(
        constraint('privacy_requests_resolved_iff_not_open'),
      );
    },
  );

  it('refuses a resolved time before the created time', async () => {
    const guest = await newGuest();

    await expect(
      client.db.execute(
        sql`INSERT INTO privacy_requests (guest_id, kind, status, created_at, resolved_at) VALUES (${guest.id}, 'access', 'completed', now(), now() - interval '1 day')`,
      ),
    ).rejects.toMatchObject(
      constraint('privacy_requests_resolved_at_in_range'),
    );
  });

  it('refuses a second open request of the same kind, and allows one of the other kind', async () => {
    const guest = await newGuest();
    await insert(guest.id, 'deletion', 'open', null);

    await expect(
      insert(guest.id, 'deletion', 'open', null),
    ).rejects.toMatchObject(constraint('privacy_requests_one_open_per_kind'));
    await insert(guest.id, 'access', 'open', null);
  });

  it('allows an open request after the earlier one was resolved', async () => {
    const guest = await newGuest();
    await insert(guest.id, 'deletion', 'declined', 'resolved');

    await insert(guest.id, 'deletion', 'open', null);
  });

  it('refuses an unknown kind, an unknown status, and a guest that does not exist', async () => {
    const guest = await newGuest();

    await expect(
      insert(guest.id, 'rectification', 'open', null),
    ).rejects.toMatchObject({ cause: { code: '22P02' } });
    await expect(
      insert(guest.id, 'access', 'stalled', null),
    ).rejects.toMatchObject({ cause: { code: '22P02' } });
    await expect(
      insert('3e1c3a40-0000-4000-8000-0000000000bb', 'access', 'open', null),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });
});

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
  const request = (guestId: string, kind = 'deletion', caller = ops) =>
    store.recordPrivacyRequest(caller, { guestId, kind });

  const requestRows = (guestId: string) =>
    rows<{ kind: string; status: string }>(
      sql`SELECT kind, status FROM privacy_requests WHERE guest_id = ${guestId}`,
    );

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
