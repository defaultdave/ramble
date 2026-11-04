import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { anonymizedEmail } from '@/lib/guests';
import { expectConstraint } from './harness';
import {
  client,
  consent,
  consentRows,
  newEmail,
  newGuest,
  rows,
  openGuestsDatabase,
} from './guestsFixtures';

// Behaviours under test, one per decision, branch or risk.
// Constraints (each bad row is refused by the database, with the constraint named):
// - guests: email shape, case, length, uniqueness; the reserved domain only on erased rows; the erased
//   address derived from the row id; erased time not before created; times in range
// - consents: each source records only the statuses it may; the guest must exist and cannot be deleted;
//   enums; time in range; append-only: update, delete, truncate (with or without cascade) refused and the
//   row stays, insert still works
// - privacy requests: open exactly when unresolved; resolved not before created; one open per guest and kind

openGuestsDatabase();

const restricted = { cause: { code: '23001' } };

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
    await expectConstraint(insert(email), 'guests_email_shape');
  });

  it('refuses a second row for the same address', async () => {
    const email = newEmail();
    await insert(email);

    await expectConstraint(insert(email), 'guests_email_unique');
  });

  it('refuses the reserved domain on a live guest', async () => {
    await expectConstraint(
      insert('pat@anonymized.invalid'),
      'guests_reserved_domain_iff_anonymized',
    );
  });

  it('refuses an erased row that keeps an ordinary address', async () => {
    await expectConstraint(
      client.db.execute(
        sql`INSERT INTO guests (email, anonymized_at) VALUES (${newEmail()}, clock_timestamp())`,
      ),
      'guests_anonymized_email_from_id',
    );
  });

  it('refuses an erased row whose address is not derived from its id', async () => {
    await expectConstraint(
      client.db.execute(
        sql`INSERT INTO guests (email, anonymized_at) VALUES ('erased-someone-else@anonymized.invalid', clock_timestamp())`,
      ),
      'guests_anonymized_email_from_id',
    );
  });

  it('refuses an erased time before the created time', async () => {
    const id = '3e1c3a40-0000-4000-8000-000000000001';
    await expectConstraint(
      client.db.execute(
        sql`INSERT INTO guests (id, email, created_at, anonymized_at) VALUES (${id}, ${anonymizedEmail(id)}, now(), now() - interval '1 day')`,
      ),
      'guests_anonymized_at_in_range',
    );
  });

  it.each([
    ['infinity', 'infinity'],
    ['a year past 9999', '10000-01-01 00:00:00+00'],
  ])('refuses a created time of %s', async (_name, value) => {
    await expectConstraint(
      client.db.execute(
        sql`INSERT INTO guests (email, created_at) VALUES (${newEmail()}, ${value}::timestamptz)`,
      ),
      'guests_created_at_in_range',
    );
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

    await expectConstraint(
      insert(guest.id, 'newsletter', status, source),
      'consents_source_allows_status',
    );
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

    await expectConstraint(
      client.db.execute(
        sql`INSERT INTO consents (guest_id, kind, status, source, recorded_at) VALUES (${guest.id}, 'newsletter', 'granted', 'checkout', 'infinity')`,
      ),
      'consents_recorded_at_in_range',
    );
  });
});

describe('consents are append-only', () => {
  const withdrawn = (guestId: string) =>
    client.db.execute(
      sql`INSERT INTO consents (guest_id, kind, status, source) VALUES (${guestId}, 'newsletter', 'withdrawn', 'unsubscribe')`,
    );

  it('still accepts a new row', async () => {
    const guest = await newGuest();
    await consent(guest.id);
    await withdrawn(guest.id);

    expect((await consentRows(guest.id)).map((row) => row.status)).toEqual([
      'granted',
      'withdrawn',
    ]);
  });

  it.each([
    [
      'update',
      (id: string) =>
        sql`UPDATE consents SET status = 'withdrawn' WHERE guest_id = ${id}`,
    ],
    [
      'delete',
      (id: string) => sql`DELETE FROM consents WHERE guest_id = ${id}`,
    ],
  ])('refuses an %s, and the row stays', async (_name, statement) => {
    const guest = await newGuest();
    await consent(guest.id);
    const before = await consentRows(guest.id);

    await expect(client.db.execute(statement(guest.id))).rejects.toMatchObject(
      restricted,
    );
    expect(await consentRows(guest.id)).toEqual(before);
  });

  it.each([['TRUNCATE consents'], ['TRUNCATE consents CASCADE']])(
    'refuses %s, and the rows stay',
    async (statement) => {
      const guest = await newGuest();
      await consent(guest.id);
      const before = await consentRows(guest.id);

      await expect(client.db.execute(sql.raw(statement))).rejects.toMatchObject(
        restricted,
      );
      expect(await consentRows(guest.id)).toEqual(before);
    },
  );
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

    await expectConstraint(
      insert(guest.id, 'access', 'open', 'resolved'),
      'privacy_requests_resolved_iff_not_open',
    );
  });

  it.each(['completed', 'declined'])(
    'refuses a %s request with no resolved time',
    async (status) => {
      const guest = await newGuest();

      await expectConstraint(
        insert(guest.id, 'access', status, null),
        'privacy_requests_resolved_iff_not_open',
      );
    },
  );

  it('refuses a resolved time before the created time', async () => {
    const guest = await newGuest();

    await expectConstraint(
      client.db.execute(
        sql`INSERT INTO privacy_requests (guest_id, kind, status, created_at, resolved_at) VALUES (${guest.id}, 'access', 'completed', now(), now() - interval '1 day')`,
      ),
      'privacy_requests_resolved_at_in_range',
    );
  });

  it('refuses a second open request of the same kind, and allows one of the other kind', async () => {
    const guest = await newGuest();
    await insert(guest.id, 'deletion', 'open', null);

    await expectConstraint(
      insert(guest.id, 'deletion', 'open', null),
      'privacy_requests_one_open_per_kind',
    );
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
