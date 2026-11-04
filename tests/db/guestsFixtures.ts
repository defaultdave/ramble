import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, vi } from 'vitest';
import { anonymizedEmail } from '@/lib/guests';
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import {
  createFreshDatabase,
  raceAgainstOpenTransaction as race,
  type FreshDatabase,
} from './harness';

let fresh: FreshDatabase;
export let client: typeof import('@/server/db/client');
export let store: typeof import('@/server/db/guests');
export let erase: typeof import('@/server/db/anonymize');

/** Opens a fresh database for the file that calls it and loads the modules that read DATABASE_URL. */
export function openGuestsDatabase() {
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
}

export type Tx = Parameters<Parameters<typeof client.db.transaction>[0]>[0];

export const ops = testCaller({ roles: [Role.Ops] });
export const admin = testCaller({ roles: [Role.Admin] });
export const guestCaller = testCaller();

let counter = 0;
export function newEmail() {
  counter += 1;
  return `guest-${String(counter)}@example.com`;
}

export function raceAgainstOpenTransaction<T>(
  holder: (tx: Tx) => Promise<void>,
  challenger: () => Promise<T>,
): Promise<T> {
  return race<Tx, T>((body) => client.db.transaction(body), holder, challenger);
}

export async function newGuest(email = newEmail()) {
  const result = await client.db.transaction((tx) =>
    store.findOrCreateGuest(tx, email),
  );
  if (result.status !== 'ok') throw new Error('The test email was refused');
  return result.guest;
}

export function consent(
  guestId: string,
  overrides: Record<string, string> = {},
) {
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

export async function rows<T extends Record<string, unknown>>(
  query: ReturnType<typeof sql>,
) {
  const { rows: found } = await client.db.execute<T>(query);
  return found;
}

export const consentRows = (guestId: string) =>
  rows<{ kind: string; status: string; source: string; recorded_at: Date }>(
    sql`SELECT kind, status, source, recorded_at FROM consents WHERE guest_id = ${guestId} ORDER BY recorded_at, id`,
  );

export async function eraseDirectly(tx: Tx, guestId: string) {
  await tx.execute(sql`SELECT id FROM guests WHERE id = ${guestId} FOR UPDATE`);
  await tx.execute(
    sql`UPDATE guests SET email = ${anonymizedEmail(guestId)}, anonymized_at = clock_timestamp() WHERE id = ${guestId}`,
  );
}

export const request = (guestId: string, kind = 'deletion', caller = ops) =>
  store.recordPrivacyRequest(caller, { guestId, kind });

export const requestRows = (guestId: string) =>
  rows<{ kind: string; status: string }>(
    sql`SELECT kind, status FROM privacy_requests WHERE guest_id = ${guestId}`,
  );
