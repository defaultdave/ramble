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

/** The migration inserts the one row, so a read that finds none refuses rather than assuming defaults. */
function onlyRow<T>(rows: T[]): T {
  const [row] = rows;
  if (!row) throw new Error('The settings row is missing');
  return row;
}

// TODO(U-030): first caller
/** The banner and the switches a guest page shows. Never a rate, a window, or a length. */
export async function getGuestSettings(): Promise<GuestSettings> {
  const rows = await dbRead
    .select()
    .from(settings)
    .where(eq(settings.id, true));
  return GuestSettingsSchema.parse(onlyRow(rows));
}

/** Where a read runs: the pool, or the transaction of a path that needs the numbers to hold still. */
type Selector = Pick<typeof db, 'select'>;

// TODO(U-014a): first caller
/**
 * Every setting, for the hold and payment paths (hold length, grace, gift validity, tax rate).
 * It holds no personal data and every caller needs it before it knows who is asking, so it takes
 * no caller. Pass a transaction to read inside one.
 */
export async function getSettings(executor: Selector = db): Promise<Settings> {
  const rows = await executor
    .select()
    .from(settings)
    .where(eq(settings.id, true));
  return SettingsSchema.parse(onlyRow(rows));
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
