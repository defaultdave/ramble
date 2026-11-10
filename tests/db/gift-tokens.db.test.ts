import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { gifts } from '@/server/db/schema';
import {
  createFreshDatabase,
  raceAgainstOpenTransaction as race,
  type FreshDatabase,
} from './harness';
import { insertGift } from './giftFixtures';
import { createOrderParents } from './orderParents';

// Behaviours under test, one per decision, branch or risk.
// - a gift token resolves to its gift by hash; a wrong, unknown, or other-kind token resolves to nothing
// - after a bump the old gift token resolves to nothing and the rebuilt one resolves to the gift
// - a bump rewrites version and hash in one statement; an unknown or malformed id changes nothing
// - a bump waits for the gift row lock and raises the version the holder committed
// - two bumps at once end two versions up
// - a bump rolled back with its caller's transaction leaves the old token working
// - a gift token presented as a manage token resolves to nothing
// - a bump past the largest version is refused and changes nothing

type Tx = Parameters<
  Parameters<(typeof import('@/server/db/client'))['db']['transaction']>[0]
>[0];

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let tokens: typeof import('@/server/tokens');
let parents: Awaited<ReturnType<typeof createOrderParents>>;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  tokens = await import('@/server/tokens');
  parents = await createOrderParents(client.db, 'gift-tokens');
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

/** A gift whose stored hash is that of its version-1 token, as a purchase writes it. */
async function insertLinkedGift() {
  const id = randomUUID();
  const token = tokens.capabilityToken('gift', id, 1);
  await insertGift(client.db, parents, {
    id,
    tokenHash: tokens.hashToken(token),
  });
  return { id, token };
}

const stored = async (id: string) => {
  const [row] = await client.db.select().from(gifts).where(eq(gifts.id, id));
  if (!row) throw new Error('gift missing');
  return row;
};

describe('resolving a gift token', () => {
  it('opens the gift for its token and refuses the others', async () => {
    const { id, token } = await insertLinkedGift();

    await expect(tokens.resolveToken('gift', token)).resolves.toEqual({
      id,
      version: 1,
    });
    await expect(
      tokens.resolveToken('gift', tokens.capabilityToken('gift', id, 2)),
    ).resolves.toBeNull();
    await expect(
      tokens.resolveToken('gift', tokens.capabilityToken('manage', id, 1)),
    ).resolves.toBeNull();
    await expect(
      tokens.resolveToken(
        'gift',
        tokens.capabilityToken('gift', randomUUID(), 1),
      ),
    ).resolves.toBeNull();
    await expect(tokens.resolveToken('gift', 'short')).resolves.toBeNull();
  });

  it('refuses a gift token presented as a manage token', async () => {
    const { token } = await insertLinkedGift();

    await expect(tokens.resolveToken('manage', token)).resolves.toBeNull();
  });
});

describe('bumping a gift token version', () => {
  it('voids the old token, and the rebuilt one opens the gift', async () => {
    const { id, token: oldToken } = await insertLinkedGift();

    const bumped = await client.db.transaction((tx) =>
      tokens.bumpTokenVersion(tx, 'gift', id),
    );

    expect(bumped).toEqual({ version: 2 });
    await expect(tokens.resolveToken('gift', oldToken)).resolves.toBeNull();
    await expect(
      tokens.resolveToken('gift', tokens.capabilityToken('gift', id, 2)),
    ).resolves.toEqual({ id, version: 2 });
  });

  it('writes the version and the hash together', async () => {
    const { id } = await insertLinkedGift();

    await client.db.transaction((tx) =>
      tokens.bumpTokenVersion(tx, 'gift', id),
    );

    const after = await stored(id);
    expect(after.tokenVersion).toBe(2);
    expect(after.tokenHash).toBe(
      tokens.hashToken(tokens.capabilityToken('gift', id, 2)),
    );
  });

  it.each([
    ['an unknown gift', () => randomUUID()],
    ['a malformed id', () => 'not-a-uuid'],
  ])('changes nothing for %s', async (_name, pick) => {
    await expect(
      client.db.transaction((tx) =>
        tokens.bumpTokenVersion(tx, 'gift', pick()),
      ),
    ).resolves.toBeNull();
  });

  it('waits for the gift lock and bumps the version the holder committed, not the one it first saw', async () => {
    const { id } = await insertLinkedGift();

    const bumped = await race<Tx, { version: number } | null>(
      (body) => client.db.transaction(body),
      async (tx) => {
        await tx.execute(sql`SELECT id FROM gifts WHERE id = ${id} FOR UPDATE`);
        await tx.execute(
          sql`UPDATE gifts SET token_version = 5 WHERE id = ${id}`,
        );
      },
      () =>
        client.db.transaction((tx) => tokens.bumpTokenVersion(tx, 'gift', id)),
    );

    expect(bumped).toEqual({ version: 6 });
    expect((await stored(id)).tokenVersion).toBe(6);
  });

  it('takes the gift lock, so two bumps at once end two versions up', async () => {
    const { id } = await insertLinkedGift();

    await Promise.all(
      Array.from({ length: 6 }, () =>
        client.db.transaction((tx) => tokens.bumpTokenVersion(tx, 'gift', id)),
      ),
    );

    const after = await stored(id);
    expect(after.tokenVersion).toBe(7);
    expect(after.tokenHash).toBe(
      tokens.hashToken(tokens.capabilityToken('gift', id, 7)),
    );
  });

  it('is undone with the caller transaction, which leaves the old token working', async () => {
    const { id, token } = await insertLinkedGift();

    await expect(
      client.db.transaction(async (tx) => {
        await tokens.bumpTokenVersion(tx, 'gift', id);
        throw new Error('caller failed');
      }),
    ).rejects.toThrow('caller failed');

    await expect(tokens.resolveToken('gift', token)).resolves.toEqual({
      id,
      version: 1,
    });
  });

  it('refuses a version past the largest instead of wrapping', async () => {
    const { id } = await insertLinkedGift();
    await client.db
      .update(gifts)
      .set({ tokenVersion: 2_147_483_647 })
      .where(eq(gifts.id, id));

    await expect(
      client.db.transaction((tx) => tokens.bumpTokenVersion(tx, 'gift', id)),
    ).rejects.toThrow(RangeError);
    expect((await stored(id)).tokenVersion).toBe(2_147_483_647);
  });
});
