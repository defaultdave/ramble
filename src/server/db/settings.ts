import 'server-only';
import { eq, sql } from 'drizzle-orm';
import {
  GuestSettingsSchema,
  HoldSettingsSchema,
  SettingsChangeSchema,
  SettingsSchema,
  type GuestSettings,
  type HoldSettings,
  type Settings,
  type SettingsChange,
} from '@/lib/settings';
import type { Caller } from '@/server/auth/caller';
import { updateTagsForChanges } from '@/server/cache/invalidate';
import { db, dbRead } from './client';
import type { Transaction } from './client';
import { settings } from './schema';
import { requireStaff } from './staff';

// TODO(U-047a): read the payment grace inside the payment transaction. TODO(U-064a): read the gift
// validity and expiry action inside the gift transactions. Each follows `readHoldSettings`.

/** The migration inserts the one row, so a read that finds none refuses rather than assuming defaults. */
function onlyRow<T>(rows: T[]): T {
  const [row] = rows;
  if (!row) throw new Error('The settings row is missing');
  return row;
}

/** The banner and the switches a guest page shows. Only these four columns leave the database. */
export async function getGuestSettings(): Promise<GuestSettings> {
  const rows = await dbRead
    .select({
      bannerText: settings.bannerText,
      bookingsPaused: settings.bookingsPaused,
      giftsEnabled: settings.giftsEnabled,
      checkoutMaintenance: settings.checkoutMaintenance,
    })
    .from(settings)
    .where(eq(settings.id, true));
  return GuestSettingsSchema.parse(onlyRow(rows));
}

/**
 * The pause switch, hold length, and tax rate, read inside the caller's open transaction with a
 * plain SELECT (no lock). The hold path needs them before it knows any caller, and a guest's
 * caller is a device, so `requireRole` has nothing to check. Exempt from B6 as a read of the
 * settings row (configuration, no personal data) that takes the caller's open transaction
 * (DECISIONS 2026-10-28, Q1). It never leaves the transaction: pages use `getGuestSettings`.
 */
export async function readHoldSettings(tx: Transaction): Promise<HoldSettings> {
  const rows = await tx
    .select({
      bookingsPaused: settings.bookingsPaused,
      holdMinutes: settings.holdMinutes,
      taxRatePpm: settings.taxRatePpm,
    })
    .from(settings)
    .where(eq(settings.id, true));
  return HoldSettingsSchema.parse(onlyRow(rows));
}

// TODO(U-078): first caller
/**
 * Sets the named settings, ops or admin only. The new values are checked here and again by the
 * database. The banner and switches are cached for guests, so the `settings` tag is invalidated.
 */
export async function updateSettings(
  caller: Caller,
  change: SettingsChange,
): Promise<Settings> {
  requireStaff(caller);
  const parsed = SettingsChangeSchema.parse(change);
  const rows = await db
    .update(settings)
    .set({ ...parsed, updatedAt: sql`now()` })
    .where(eq(settings.id, true))
    .returning();
  const saved = SettingsSchema.parse(onlyRow(rows));
  updateTagsForChanges([{ kind: 'settings' }]);
  return saved;
}
