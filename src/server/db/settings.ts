import 'server-only';
import { eq, sql } from 'drizzle-orm';
import {
  GuestSettingsSchema,
  HoldSettingsSchema,
  SettingsChangeSchema,
  SettingsSchema,
  type GuestSettings,
  type HoldSettings,
  type SettingKey,
  type Settings,
  type SettingsChange,
} from '@/lib/settings';
import { changedSettingKeys } from '@/lib/opsSettings';
import { settingsChangedEntry } from '@/lib/settingsAudit';
import { Role, type Caller } from '@/server/auth/caller';
import { updateTagsForChanges } from '@/server/cache/invalidate';
import { requireUserId, writeAudit } from './audit';
import { db, dbRead } from './client';
import type { Transaction } from './client';
import { settings } from './schema';
import { requireStaff } from './staff';

// TODO(U-064a): read the gift validity and expiry action inside the gift transactions, following `readHoldSettings`.

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
 * The pause switch, hold length, payment grace, and tax rate, read inside the caller's open transaction with a
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
      paymentGraceMinutes: settings.paymentGraceMinutes,
      taxRatePpm: settings.taxRatePpm,
    })
    .from(settings)
    .where(eq(settings.id, true));
  return HoldSettingsSchema.parse(onlyRow(rows));
}

/** Every setting, for ops or admin. Read from the primary, so the page that follows a save shows it. */
export async function readSettings(caller: Caller): Promise<Settings> {
  requireStaff(caller);
  const rows = await db.select().from(settings).where(eq(settings.id, true));
  return SettingsSchema.parse(onlyRow(rows));
}

/** The settings as saved, and which of them the save changed (none for a save of the stored values). */
export type SettingsSaved = Settings & { changed: SettingKey[] };

/**
 * Sets the named settings, ops or admin only. The new values are checked here and again by the
 * database. The row is locked and read first, so what counts as changed is judged against what is
 * stored now; a save that changes nothing writes nothing, audit row included. The update and its
 * audit row are one transaction. The banner and switches are cached for guests, so a save that
 * changed something invalidates the `settings` tag after the commit.
 */
export async function updateSettings(
  caller: Caller,
  change: SettingsChange,
): Promise<SettingsSaved> {
  requireStaff(caller);
  const userId = requireUserId(caller, Role.Ops);
  const parsed = SettingsChangeSchema.parse(change);
  const saved = await db.transaction(async (tx) => {
    const current = SettingsSchema.parse(
      onlyRow(
        await tx
          .select()
          .from(settings)
          .where(eq(settings.id, true))
          .for('update'),
      ),
    );
    const changed = changedSettingKeys(current, parsed);
    if (changed.length === 0) return { ...current, changed };
    const rows = await tx
      .update(settings)
      .set({ ...parsed, updatedAt: sql`clock_timestamp()` })
      .where(eq(settings.id, true))
      .returning();
    const after = SettingsSchema.parse(onlyRow(rows));
    await writeAudit(tx, settingsChangedEntry(userId, current, after, changed));
    return { ...after, changed };
  });
  if (saved.changed.length > 0) updateTagsForChanges([{ kind: 'settings' }]);
  return saved;
}
