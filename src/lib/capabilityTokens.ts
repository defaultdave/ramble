import { EntityIdSchema } from './catalog';

// How a capability link (a manage link, a confirmation URL) is made. A token is derived, never
// random: an HMAC of its kind, the row id, and a version, so any server code can rebuild a link and
// a bump of the version voids the earlier ones (design doc 4.2.3, the capability-token amendment).

/** `gift` joins these when the gifts table exists (U-017). */
export const capabilityTokenKinds = ['manage', 'order'] as const;
export type CapabilityTokenKind = (typeof capabilityTokenKinds)[number];

/** The kinds whose hash is stored on the row. An `order` token is checked by recomputing it. */
const hashStoredKinds = ['manage'] as const;
export type HashStoredKind = (typeof hashStoredKinds)[number];

export function storesHash(kind: CapabilityTokenKind): kind is HashStoredKind {
  return (hashStoredKinds as readonly string[]).includes(kind);
}

/** A stored token hash: lower-case hex SHA-256. */
export const tokenHashPattern = '^[0-9a-f]{64}$';
const tokenHashRegex = new RegExp(tokenHashPattern);
const tokenHashLength = 64;

export function isTokenHash(value: string): boolean {
  return value.length === tokenHashLength && tokenHashRegex.test(value);
}

/** Base64url of a 32-byte HMAC-SHA256. */
const capabilityTokenLength = 43;
const tokenShapeRegex = /^[A-Za-z0-9_-]+$/;

/** Checked before any lookup, so a token of any other shape does no work and reaches no query. */
export function isCapabilityTokenShape(token: string): boolean {
  return token.length === capabilityTokenLength && tokenShapeRegex.test(token);
}

/** A version is a Postgres integer, so a bump past the largest is refused rather than wrapped. */
export const maxTokenVersion = 2_147_483_647;

function requireVersion(version: number): void {
  if (
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > maxTokenVersion
  ) {
    throw new RangeError(
      `A token version is an integer from 1 to ${String(maxTokenVersion)}, got ${String(version)}`,
    );
  }
}

export function nextTokenVersion(current: number): number {
  requireVersion(current);
  if (current === maxTokenVersion) {
    throw new RangeError('The token version cannot be raised any further');
  }
  return current + 1;
}

/**
 * What the HMAC covers. The kind, the id, and the version are joined with a separator none of them
 * contains, so no two triples give one message, and a token for one kind never opens another.
 */
export function capabilityTokenMessage(
  kind: CapabilityTokenKind,
  id: string,
  version: number,
): string {
  requireVersion(version);
  if (!EntityIdSchema.safeParse(id).success) {
    throw new RangeError('A token is made for a row id (a uuid)');
  }
  return `${kind}:${id.toLowerCase()}:${String(version)}`;
}

/** A fixed, obviously fake secret, used under Vitest only. */
const TEST_CAPABILITY_TOKEN_SECRET =
  'test-only-capability-token-secret-not-a-real-secret';

/**
 * The configured secret; in `test` a fixed fake one; otherwise null, and the caller refuses. Unlike
 * the form guard, development has no stand-in: a token opens a booking, so a missing secret fails closed.
 */
export function pickCapabilityTokenSecret(
  configured: string | undefined,
  nodeEnv: 'development' | 'test' | 'production',
): string | null {
  if (configured) return configured;
  return nodeEnv === 'test' ? TEST_CAPABILITY_TOKEN_SECRET : null;
}

/**
 * The manage hash an order holds after a bump: the rebuilt one, but only if it held one. An order
 * that is not confirmed has none yet, and a bump must not make its manage link live.
 */
export function manageHashAfterBump(
  hadManageHash: boolean,
  rebuiltHash: string,
): string | null {
  return hadManageHash ? rebuiltHash : null;
}

/** A secret rotation re-hashes this many orders per transaction, so no statement or lock grows with the table. */
export const rehashBatchSize = 500;

/** The most batches one rotation runs (a million orders); more than that stops with an error instead of looping on. */
export const maxRehashBatches = 2000;

export type RehashOptions = { batchSize?: number; maxBatches?: number };

/** The re-hash limits to use: the defaults, or smaller ones a caller passes (a test, an ops run). Larger or non-integer values are refused. */
export function rehashLimits(options: RehashOptions = {}): {
  batchSize: number;
  maxBatches: number;
} {
  const batchSize = options.batchSize ?? rehashBatchSize;
  const maxBatches = options.maxBatches ?? maxRehashBatches;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > rehashBatchSize
  ) {
    throw new RangeError(
      `The batch size is an integer from 1 to ${String(rehashBatchSize)}`,
    );
  }
  if (
    !Number.isInteger(maxBatches) ||
    maxBatches < 1 ||
    maxBatches > maxRehashBatches
  ) {
    throw new RangeError(
      `The batch limit is an integer from 1 to ${String(maxRehashBatches)}`,
    );
  }
  return { batchSize, maxBatches };
}
