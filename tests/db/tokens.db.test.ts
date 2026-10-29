import { randomInt, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { orders } from '@/server/db/schema';
import {
  createFreshDatabase,
  raceAgainstOpenTransaction as race,
  type FreshDatabase,
} from './harness';
import { createOrderParents } from './orderParents';

// Behaviours under test, one per decision, branch or risk.
// - a manage token resolves to its order by hash; a wrong, unknown, or other-kind token resolves to nothing
// - an order token resolves by reference, checked by recomputing; a wrong reference or token resolves to nothing
// - after a bump the old manage and order tokens resolve to nothing and the rebuilt ones resolve to the order
// - a bump rewrites version and hash in one statement; an order with no hash keeps none; an unknown or malformed id changes nothing
// - two bumps at once end two versions up (the order row lock serializes them)
// - a bump rolled back with its caller's transaction leaves the old token working
// - a rotation: tokens made under the old secret stop working, the re-hash makes the new secret's tokens resolve, and it rewrites only hashed orders

type Tx = Parameters<
  Parameters<(typeof import('@/server/db/client'))['db']['transaction']>[0]
>[0];

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let parents: Awaited<ReturnType<typeof createOrderParents>>;
const clients: (typeof import('@/server/db/client'))[] = [];

const oldSecret = 'o'.repeat(40);
const newSecret = 'n'.repeat(40);

async function loadTokens(secret: string) {
  vi.resetModules();
  vi.stubEnv('CAPABILITY_TOKEN_SECRET', secret);
  vi.stubEnv('DATABASE_URL', fresh.url);
  const loaded = await import('@/server/tokens');
  clients.push(await import('@/server/db/client'));
  return loaded;
}

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  clients.push(client);
  parents = await createOrderParents(client.db, 'tokens');
});

afterAll(async () => {
  for (const loaded of clients) await loaded.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function reference() {
  return `RMB-${Array.from({ length: 6 }, () => crockford[randomInt(crockford.length)]).join('')}`;
}

async function insertOrder(manageTokenHash: string | null = null) {
  const holdId = randomUUID();
  const [row] = await client.db
    .insert(orders)
    .values({
      reference: reference(),
      kind: 'booking',
      status: 'confirmed',
      idempotencyKey: `book:${holdId}`,
      holdId,
      sessionId: randomUUID(),
      experienceId: parents.experienceId,
      hostId: parents.hostId,
      guestId: parents.guestId,
      contactEmail: 'pat@example.com',
      leadGuestName: 'Pat',
      termsDocumentId: randomUUID(),
      ticketSubtotalMinor: 17000,
      taxTreatment: 'not_taxable',
      taxRatePpm: 0,
      taxMinor: 0,
      totalMinor: 17000,
      amountDueMinor: 17000,
      commissionRateBps: 1500,
      commissionMinor: 2550,
      cancellationTierId: parents.tierId,
      manageTokenHash,
      confirmedAt: sql`clock_timestamp()`,
    })
    .returning();
  if (!row) throw new Error('insert returned no order');
  return row;
}

async function insertConfirmedWithLink(
  tokens: typeof import('@/server/tokens'),
) {
  const row = await insertOrder();
  const token = tokens.capabilityToken('manage', row.id, 1);
  await client.db
    .update(orders)
    .set({ manageTokenHash: tokens.hashToken(token) })
    .where(eq(orders.id, row.id));
  return { row, token };
}

const stored = async (id: string) => {
  const [row] = await client.db.select().from(orders).where(eq(orders.id, id));
  if (!row) throw new Error('order missing');
  return row;
};

describe('resolving a token', () => {
  it('opens the order for its manage token and refuses the others', async () => {
    const tokens = await loadTokens(oldSecret);
    const { row, token } = await insertConfirmedWithLink(tokens);

    await expect(tokens.resolveToken('manage', token)).resolves.toEqual({
      id: row.id,
      version: 1,
    });
    await expect(
      tokens.resolveToken(
        'manage',
        tokens.capabilityToken('manage', row.id, 2),
      ),
    ).resolves.toBeNull();
    await expect(
      tokens.resolveToken('manage', tokens.capabilityToken('order', row.id, 1)),
    ).resolves.toBeNull();
    await expect(
      tokens.resolveToken(
        'manage',
        tokens.capabilityToken('manage', randomUUID(), 1),
      ),
    ).resolves.toBeNull();
  });

  it('opens the order for its order token by reference, with no hash stored', async () => {
    const tokens = await loadTokens(oldSecret);
    const row = await insertOrder();
    const token = tokens.capabilityToken('order', row.id, 1);

    await expect(
      tokens.resolveToken('order', token, row.reference),
    ).resolves.toEqual({ id: row.id, version: 1 });
    expect((await stored(row.id)).manageTokenHash).toBeNull();
  });

  it.each([
    ['another order reference', () => reference()],
    ['a malformed reference', () => 'nope'],
  ])('refuses an order token with %s', async (_name, pick) => {
    const tokens = await loadTokens(oldSecret);
    const row = await insertOrder();
    const token = tokens.capabilityToken('order', row.id, 1);

    await expect(
      tokens.resolveToken('order', token, pick()),
    ).resolves.toBeNull();
  });

  it('refuses a manage token presented as an order token, and the reverse', async () => {
    const tokens = await loadTokens(oldSecret);
    const row = await insertOrder();

    await expect(
      tokens.resolveToken(
        'order',
        tokens.capabilityToken('manage', row.id, 1),
        row.reference,
      ),
    ).resolves.toBeNull();
  });
});

describe('bumping a version', () => {
  it('voids the old tokens and the rebuilt ones open the order', async () => {
    const tokens = await loadTokens(oldSecret);
    const { row, token: oldManage } = await insertConfirmedWithLink(tokens);
    const oldOrder = tokens.capabilityToken('order', row.id, 1);

    const bumped = await client.db.transaction((tx) =>
      tokens.bumpTokenVersion(tx, 'manage', row.id),
    );

    expect(bumped).toEqual({ version: 2 });
    await expect(tokens.resolveToken('manage', oldManage)).resolves.toBeNull();
    await expect(
      tokens.resolveToken('order', oldOrder, row.reference),
    ).resolves.toBeNull();
    await expect(
      tokens.resolveToken(
        'manage',
        tokens.capabilityToken('manage', row.id, 2),
      ),
    ).resolves.toEqual({ id: row.id, version: 2 });
    await expect(
      tokens.resolveToken(
        'order',
        tokens.capabilityToken('order', row.id, 2),
        row.reference,
      ),
    ).resolves.toEqual({ id: row.id, version: 2 });
  });

  it('writes the version and the hash together', async () => {
    const tokens = await loadTokens(oldSecret);
    const { row } = await insertConfirmedWithLink(tokens);

    await client.db.transaction((tx) =>
      tokens.bumpTokenVersion(tx, 'manage', row.id),
    );

    const after = await stored(row.id);
    expect(after.manageTokenVersion).toBe(2);
    expect(after.manageTokenHash).toBe(
      tokens.hashToken(tokens.capabilityToken('manage', row.id, 2)),
    );
  });

  it('keeps no hash for an order that has none, so no manage link goes live early', async () => {
    const tokens = await loadTokens(oldSecret);
    const row = await insertOrder();

    await client.db.transaction((tx) =>
      tokens.bumpTokenVersion(tx, 'order', row.id),
    );

    const after = await stored(row.id);
    expect(after.manageTokenVersion).toBe(2);
    expect(after.manageTokenHash).toBeNull();
  });

  it.each([
    ['an unknown order', () => randomUUID()],
    ['a malformed id', () => 'not-a-uuid'],
  ])('changes nothing for %s', async (_name, pick) => {
    const tokens = await loadTokens(oldSecret);

    await expect(
      client.db.transaction((tx) =>
        tokens.bumpTokenVersion(tx, 'manage', pick()),
      ),
    ).resolves.toBeNull();
  });

  it('waits for the order lock and bumps the version the holder committed, not the one it first saw', async () => {
    const tokens = await loadTokens(oldSecret);
    const { row } = await insertConfirmedWithLink(tokens);

    const bumped = await race<Tx, { version: number } | null>(
      (body) => client.db.transaction(body),
      async (tx) => {
        await tx.execute(
          sql`SELECT id FROM orders WHERE id = ${row.id} FOR UPDATE`,
        );
        await tx.execute(
          sql`UPDATE orders SET manage_token_version = 5 WHERE id = ${row.id}`,
        );
      },
      () =>
        client.db.transaction((tx) =>
          tokens.bumpTokenVersion(tx, 'manage', row.id),
        ),
    );

    expect(bumped).toEqual({ version: 6 });
    expect((await stored(row.id)).manageTokenVersion).toBe(6);
  });

  it('takes the order lock, so two bumps at once end two versions up', async () => {
    const tokens = await loadTokens(oldSecret);
    const { row } = await insertConfirmedWithLink(tokens);

    await Promise.all(
      Array.from({ length: 6 }, () =>
        client.db.transaction((tx) =>
          tokens.bumpTokenVersion(tx, 'manage', row.id),
        ),
      ),
    );

    const after = await stored(row.id);
    expect(after.manageTokenVersion).toBe(7);
    expect(after.manageTokenHash).toBe(
      tokens.hashToken(tokens.capabilityToken('manage', row.id, 7)),
    );
  });

  it('is undone with the caller transaction, which leaves the old token working', async () => {
    const tokens = await loadTokens(oldSecret);
    const { row, token } = await insertConfirmedWithLink(tokens);

    await expect(
      client.db.transaction(async (tx) => {
        await tokens.bumpTokenVersion(tx, 'manage', row.id);
        throw new Error('caller failed');
      }),
    ).rejects.toThrow('caller failed');

    await expect(tokens.resolveToken('manage', token)).resolves.toEqual({
      id: row.id,
      version: 1,
    });
  });
});

describe('rotating the secret', () => {
  it('voids every link until the re-hash makes the new secret resolve, and skips orders with no hash', async () => {
    const before = await loadTokens(oldSecret);
    const first = await insertConfirmedWithLink(before);
    const second = await insertConfirmedWithLink(before);
    await client.db.transaction((tx) =>
      before.bumpTokenVersion(tx, 'manage', second.row.id),
    );
    const unlinked = await insertOrder();

    const after = await loadTokens(newSecret);

    await expect(after.resolveToken('manage', first.token)).resolves.toBeNull();
    await expect(
      after.resolveToken(
        'manage',
        after.capabilityToken('manage', first.row.id, 1),
      ),
    ).resolves.toBeNull();

    const rewritten = await after.rehashTokens('manage');

    expect(rewritten).toBeGreaterThanOrEqual(2);
    await expect(
      after.resolveToken(
        'manage',
        after.capabilityToken('manage', first.row.id, 1),
      ),
    ).resolves.toEqual({ id: first.row.id, version: 1 });
    await expect(
      after.resolveToken(
        'manage',
        after.capabilityToken('manage', second.row.id, 2),
      ),
    ).resolves.toEqual({ id: second.row.id, version: 2 });
    await expect(after.resolveToken('manage', first.token)).resolves.toBeNull();
    expect((await stored(unlinked.id)).manageTokenHash).toBeNull();
  });

  it('is a no-op when run again', async () => {
    const tokens = await loadTokens(newSecret);
    const total = await tokens.rehashTokens('manage');

    await expect(tokens.rehashTokens('manage')).resolves.toBe(total);
  });

  it('re-hashes every order across several pages, and a page missed is an error, not a silent skip', async () => {
    const before = await loadTokens(oldSecret);
    const made = [];
    for (let i = 0; i < 7; i += 1) {
      made.push(await insertConfirmedWithLink(before));
    }
    const { rows } = await client.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM orders WHERE manage_token_hash IS NOT NULL`,
    );
    const hashed = rows[0]?.n ?? 0;
    expect(hashed).toBeGreaterThanOrEqual(7);
    const rotated = await loadTokens('p'.repeat(40));

    await expect(
      rotated.rehashTokens('manage', { batchSize: 2, maxBatches: 1 }),
    ).rejects.toThrow('batch limit');

    const pages = Math.ceil(hashed / 2);
    await expect(
      rotated.rehashTokens('manage', { batchSize: 2, maxBatches: pages }),
    ).resolves.toBe(hashed);
    for (const { row } of made) {
      await expect(
        rotated.resolveToken(
          'manage',
          rotated.capabilityToken('manage', row.id, 1),
        ),
      ).resolves.toEqual({ id: row.id, version: 1 });
    }
  });

  it.each([{ batchSize: 0 }, { batchSize: 501 }, { maxBatches: 0 }])(
    'refuses the limits %j before it touches a row',
    async (options) => {
      const tokens = await loadTokens(newSecret);

      await expect(tokens.rehashTokens('manage', options)).rejects.toThrow(
        RangeError,
      );
    },
  );
});
