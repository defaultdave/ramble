import 'server-only';
import { createHmac } from 'node:crypto';
import {
  canRehash,
  capabilityTokenMessage,
  isCapabilityTokenShape,
  manageHashAfterBump,
  nextTokenVersion,
  pickCapabilityTokenSecret,
  rehashLimits,
  type CapabilityTokenKind,
  type RehashKind,
  type RehashOptions,
} from '@/lib/capabilityTokens';
import { WriteIdSchema } from '@/lib/catalog';
import { isOrderReference } from '@/lib/orders';
import { db, type Transaction } from '@/server/db/client';
import {
  lockGiftTokenVersion,
  readGiftByTokenHash,
  writeGiftTokenVersion,
} from '@/server/db/giftTokens';
import {
  lockOrderTokenState,
  readManageTokenPage,
  readOrderByManageHash,
  readOrderByReference,
  writeManageHashes,
  writeOrderTokenVersion,
  type OrderTokenRow,
} from '@/server/db/orderTokens';
import { env } from '@/server/env';
import { secureEqual, sha256Hex } from '@/server/hash';

// Capability links (design doc 4.2.3, the accepted amendment, option A): a token is derived from
// the row, so any server code can rebuild a link, and the version bumps to void the earlier ones.
// The `manage` and `order` kinds live on `orders` and share its `manage_token_version`, so one bump
// voids the manage link and the confirmation URL together. A `gift` token lives on `gifts`.

function secret(): string {
  const configured = pickCapabilityTokenSecret(
    env.CAPABILITY_TOKEN_SECRET,
    env.NODE_ENV,
  );
  if (configured === null)
    throw new Error('CAPABILITY_TOKEN_SECRET is not set');
  return configured;
}

/** HMAC-SHA256 of the kind, the row id, and the version, as base64url (43 characters). */
export function capabilityToken(
  kind: CapabilityTokenKind,
  id: string,
  version: number,
): string {
  return createHmac('sha256', secret())
    .update(capabilityTokenMessage(kind, id, version))
    .digest('base64url');
}

/** What is stored for a `manage` token: the lower-case hex SHA-256 of the token. */
export function hashToken(token: string): string {
  return sha256Hex(token);
}

export type ResolvedToken = OrderTokenRow;

// TODO(U-064a): first caller of the `gift` kind, redeemGift; U-064b follows.
export async function resolveToken(
  kind: 'manage' | 'gift',
  token: string,
): Promise<ResolvedToken | null>;
export async function resolveToken(
  kind: 'order',
  token: string,
  reference: string,
): Promise<ResolvedToken | null>;
/**
 * The row a token opens, or null. A `manage` token is found by its stored hash on an order, a
 * `gift` token by its stored hash on a gift; an `order` token stores none, so it is found by the
 * order's reference. Either way the token is then compared, in constant time, against the one recomputed for the row's current version, so a token from before a
 * bump, a token of another kind, and a token that merely hashes alike all resolve to nothing.
 */
export async function resolveToken(
  kind: CapabilityTokenKind,
  token: string,
  reference?: string,
): Promise<ResolvedToken | null> {
  if (!isCapabilityTokenShape(token)) return null;
  let row: ResolvedToken | null;
  if (kind === 'manage') {
    row = await readOrderByManageHash(hashToken(token));
  } else if (kind === 'gift') {
    row = await readGiftByTokenHash(hashToken(token));
  } else {
    if (reference === undefined || !isOrderReference(reference)) return null;
    row = await readOrderByReference(reference);
  }
  if (row === null) return null;
  return secureEqual(capabilityToken(kind, row.id, row.version), token)
    ? row
    : null;
}

// TODO(U-077): first caller, "void earlier links"; U-113 follows for gifts.
/**
 * Raises the row's token version by one and, in the same UPDATE, rewrites the stored hash to the
 * new token. For `manage` and `order` the row is the order, and the new manage token voids the
 * earlier manage link and confirmation URL; an order that has no manage hash yet (not confirmed)
 * keeps none. For `gift` the row is the gift, which always holds a hash. Joins the caller's
 * transaction and takes the row lock itself, so two bumps never read one version. Null when the
 * row does not exist.
 */
export async function bumpTokenVersion(
  tx: Transaction,
  kind: CapabilityTokenKind,
  id: string,
): Promise<{ version: number } | null> {
  switch (kind) {
    case 'manage':
    case 'order':
    case 'gift':
      break;
    default:
      throw new RangeError(
        `Unknown token kind: ${String(kind satisfies never)}`,
      );
  }
  const parsed = WriteIdSchema.safeParse(id);
  if (!parsed.success) return null;
  if (kind === 'gift') {
    const current = await lockGiftTokenVersion(tx, parsed.data);
    if (current === null) return null;
    const next = nextTokenVersion(current);
    await writeGiftTokenVersion(
      tx,
      parsed.data,
      next,
      hashToken(capabilityToken('gift', parsed.data, next)),
    );
    return { version: next };
  }
  const state = await lockOrderTokenState(tx, parsed.data);
  if (state === null) return null;
  const version = nextTokenVersion(state.version);
  const hash = manageHashAfterBump(
    state.hasManageHash,
    hashToken(capabilityToken('manage', parsed.data, version)),
  );
  await writeOrderTokenVersion(tx, parsed.data, version, hash);
  return { version };
}

// TODO(U-099): first caller, the secret rotation runbook.
/**
 * After `CAPABILITY_TOKEN_SECRET` changes: rewrites every stored hash to the one the new secret
 * gives for the row's current version. Runs in batches by id, each its own transaction, and stops
 * with an error rather than loop past the cap. Returns how many hashes it rewrote.
 */
export async function rehashTokens(
  kind: RehashKind,
  options: RehashOptions = {},
): Promise<number> {
  const { batchSize, maxBatches } = rehashLimits(options);
  if (!canRehash(kind)) return 0;
  let rewritten = 0;
  let afterId: string | null = null;
  // The cap counts pages that returned rows; the empty read that ends the run is free, so exactly
  // maxBatches full pages succeed and one more non-empty page is an error.
  for (let pages = 1; ; pages += 1) {
    const page = await readManageTokenPage(afterId, batchSize);
    const last = page.at(-1);
    if (!last) return rewritten;
    if (pages > maxBatches) {
      throw new Error('The re-hash did not finish within its batch limit');
    }
    const rows = page.map((row) => ({
      id: row.id,
      version: row.version,
      hash: hashToken(capabilityToken(kind, row.id, row.version)),
    }));
    rewritten += await db.transaction((tx) => writeManageHashes(tx, rows));
    if (page.length < batchSize) return rewritten;
    afterId = last.id;
  }
}
