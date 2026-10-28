import 'server-only';
import { eq, sql } from 'drizzle-orm';
import {
  GuestSettingsSchema,
  SettingsChangeSchema,
  SettingsSchema,
  type GuestSettings,
  type Settings,
  type SettingsChange,
} from '@/lib/settings';
import type { Caller } from '@/server/auth/caller';
import { updateTagsForChanges } from '@/server/cache/invalidate';
import { db, dbRead } from './client';
import { settings } from './schema';
import { requireStaff } from './staff';

// TODO(U-014a): read the hold length, payment grace, gift validity, gift expiry action, and tax rate
// inside the hold and payment transactions. That read has no signed-in caller (the guest is a device),
// so it waits for a rule on how such a read checks the caller, and for the first path that needs it.

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
