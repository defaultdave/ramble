import { z } from 'zod';
import { WriteIdSchema } from './catalog';
import { IsoDateSchema } from './sessions';
import { canStoreVisibility, type StorageCapabilities } from './storage';
import { isoDateOf, msPerDay, msPerMinute } from './time';

export const auditActorKinds = ['user', 'guest', 'system'] as const;
export type AuditActorKind = (typeof auditActorKinds)[number];

/**
 * The numbers the audit log runs on. The first six are also enforced by the `audit_log` CHECKs;
 * the export numbers change here without a migration.
 */
export const auditLimits = {
  actionMaxChars: 64,
  subjectKindMaxChars: 40,
  detailsMaxKeys: 16,
  detailsKeyMaxChars: 40,
  detailsValueMaxChars: 100,
  detailsStoredMaxBytes: 4096,
  exportPageRows: 2000,
  exportMaxParts: 50,
  exportGraceMinutes: 60,
  exportLookbackDays: 7,
} as const;

/** Shared with the `audit_log` CHECKs, which spell the same patterns. */
export const auditPatterns = {
  action: String.raw`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`,
  word: String.raw`^[a-z][a-z0-9_]*$`,
  detailValue: String.raw`^[A-Za-z0-9][A-Za-z0-9:_./-]{0,99}$`,
} as const;

/**
 * A dotted action such as `order.cancelled`: two or more lower-case words joined by dots. Checked
 * by splitting, because V8 matches a repeated group by recursion and the CHECK's pattern has one.
 */
export function isAuditAction(value: string): boolean {
  if (value.length > auditLimits.actionMaxChars) return false;
  const words = value.split('.');
  return (
    words.length >= 2 && words.every((word) => /^[a-z][a-z0-9_]*$/.test(word))
  );
}

const ActionSchema = z
  .string()
  .max(auditLimits.actionMaxChars)
  .refine(isAuditAction, {
    message: 'Dotted lower-case words, such as order.cancelled',
  });

const wordSchema = (max: number) =>
  z.string().max(max).regex(new RegExp(auditPatterns.word));

const SafeIntegerSchema = z.int();

/**
 * Ids, codes, and amounts only. A string value has no space and no `@`, so a name, an address, or
 * a sentence cannot be written into a row that can never be corrected or erased.
 */
const DetailValueSchema = z.union([
  SafeIntegerSchema,
  z.boolean(),
  z.null(),
  z
    .string()
    .max(auditLimits.detailsValueMaxChars)
    .regex(new RegExp(auditPatterns.detailValue)),
]);

const DetailsSchema = z
  .custom<Record<string, unknown>>(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      // Zod's record skips an own `__proto__` key, so it would reach the database as a different row.
      !Object.hasOwn(value, '__proto__') &&
      Object.keys(value).length <= auditLimits.detailsMaxKeys,
    {
      message: `A flat object of at most ${String(auditLimits.detailsMaxKeys)} keys`,
    },
  )
  .pipe(
    z.record(wordSchema(auditLimits.detailsKeyMaxChars), DetailValueSchema),
  );

/** Whether the actor kind and the actor id agree: a signed-in user is named, a guest or the system is not. */
export function actorMatchesKind(
  kind: AuditActorKind,
  actorId: string | null | undefined,
): boolean {
  return (kind === 'user') === (actorId !== null && actorId !== undefined);
}

const AuditEntrySchema = z
  .strictObject({
    actorKind: z.enum(auditActorKinds),
    actorId: WriteIdSchema.nullish(),
    action: ActionSchema,
    subjectKind: wordSchema(auditLimits.subjectKindMaxChars),
    subjectId: WriteIdSchema,
    details: DetailsSchema.default({}),
  })
  .refine((entry) => actorMatchesKind(entry.actorKind, entry.actorId), {
    path: ['actorId'],
    message: 'A user action names the user; a guest or system action does not',
  })
  .transform((entry) => ({ ...entry, actorId: entry.actorId ?? null }));

export type AuditEntryInput = z.input<typeof AuditEntrySchema>;
export type AuditEntry = z.output<typeof AuditEntrySchema>;

/** Validates one audit row before it is written; throws a `ZodError` that names the field and never echoes the value. */
export function parseAuditEntry(input: unknown): AuditEntry {
  return AuditEntrySchema.parse(input);
}

// The export.

/** A row as the export writes it. */
export type AuditRow = {
  id: number;
  recordedAt: Date;
  actorKind: AuditActorKind;
  actorId: string | null;
  action: string;
  subjectKind: string;
  subjectId: string;
  /** Written out as stored; the table's CHECKs already hold it to the shape `AuditEntrySchema` accepts. */
  details: unknown;
};

export const ExportDaySchema = IsoDateSchema.refine(
  (day) => day >= '2000-01-01' && day < '9999-01-01',
  'A real calendar date from the year 2000 to 9998',
);

export type ExportDay = z.output<typeof ExportDaySchema>;

export const auditExportKind = 'audit-export';

export const AuditExportPayloadSchema = z.strictObject({
  day: ExportDaySchema,
});
export type AuditExportPayload = z.output<typeof AuditExportPayloadSchema>;

/** The UTC day that `day` names, as a half-open range of `recorded_at`. */
export function exportWindow(day: ExportDay): { from: Date; to: Date } {
  const from = new Date(`${day}T00:00:00Z`);
  return { from, to: new Date(from.getTime() + msPerDay) };
}

/**
 * Whether a day is over, and the grace period after it has passed. The grace lets a transaction
 * that started before midnight commit its audit row before the day is read, because an exported
 * day is never written again.
 */
export function exportDayReady(day: ExportDay, now: Date): boolean {
  const { to } = exportWindow(day);
  return (
    now.getTime() >= to.getTime() + auditLimits.exportGraceMinutes * msPerMinute
  );
}

/**
 * The days the pulse should make sure are queued, oldest first: every ready day from the day of
 * the first audit row, going back at most a week. A log with no rows queues nothing. Each day has
 * its own dedupe key, so a day queues once and an outage shorter than the lookback catches up.
 */
export function exportDaysDue(
  now: Date,
  firstRecordedAt: Date | null,
): ExportDay[] {
  if (firstRecordedAt === null) return [];
  const earliest = Math.max(
    Date.parse(`${isoDateOf(firstRecordedAt)}T00:00:00Z`),
    Date.parse(`${isoDateOf(now)}T00:00:00Z`) -
      auditLimits.exportLookbackDays * msPerDay,
  );
  const days: ExportDay[] = [];
  for (
    let at = earliest;
    days.length < auditLimits.exportLookbackDays;
    at += msPerDay
  ) {
    const day = isoDateOf(new Date(at));
    if (!exportDayReady(day, now)) break;
    days.push(day);
  }
  return days;
}

/** Whether the audit export may run: only on a store that can hold an audit object, so a day is never reported exported into one that cannot. */
export function auditExportsOn(capabilities: StorageCapabilities): boolean {
  return canStoreVisibility('audit', capabilities);
}

export function exportDedupeKey(day: ExportDay): string {
  return `audit-export:${day}`;
}

/** Where a part of a day's export is stored. Parts are numbered from 1. */
export function exportPartKey(day: ExportDay, part: number): string {
  return `audit/${day}/part-${String(part).padStart(4, '0')}.ndjson`;
}

export function exportManifestKey(day: ExportDay): string {
  return `audit/${day}/manifest.ndjson`;
}

export const exportContentType = 'application/x-ndjson';

/** One line per row, fields in a fixed order, so the same rows always make the same bytes. */
export function exportLines(rows: readonly AuditRow[]): Uint8Array {
  const text = rows
    .map((row) =>
      JSON.stringify({
        id: row.id,
        recordedAt: row.recordedAt.toISOString(),
        actorKind: row.actorKind,
        actorId: row.actorId,
        action: row.action,
        subjectKind: row.subjectKind,
        subjectId: row.subjectId,
        details: row.details,
      }),
    )
    .join('\n');
  return new TextEncoder().encode(`${text}\n`);
}

export type ExportTally = {
  parts: number;
  rows: number;
  firstId: number | null;
  lastId: number | null;
};

export const emptyExportTally: ExportTally = {
  parts: 0,
  rows: 0,
  firstId: null,
  lastId: null,
};

/** A page shorter than the page size is the last one. */
function isFinalPage(count: number): boolean {
  return count < auditLimits.exportPageRows;
}

export type ExportStep =
  | { action: 'finish' }
  /** More rows than the part limit allows: fail, never drop rows. */
  | { action: 'refuse' }
  | {
      action: 'write';
      tally: ExportTally;
      /** The cursor for the next page: the last id written. */
      afterId: number;
      /** No page follows this one. */
      last: boolean;
    };

/**
 * What the export does with the page it just read (in id order): nothing left, too many parts
 * already, or write it as the next part and say where the next page starts.
 */
export function exportStep(
  tally: ExportTally,
  page: readonly AuditRow[],
): ExportStep {
  const last = page.at(-1);
  if (!last) return { action: 'finish' };
  if (tally.parts >= auditLimits.exportMaxParts) return { action: 'refuse' };
  return {
    action: 'write',
    tally: {
      parts: tally.parts + 1,
      rows: tally.rows + page.length,
      firstId: tally.firstId ?? page[0]?.id ?? last.id,
      lastId: last.id,
    },
    afterId: last.id,
    last: isFinalPage(page.length),
  };
}

/** The last object of a day: its existence says the day was exported whole, and an empty day says so too. */
export function exportManifest(day: ExportDay, tally: ExportTally): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify({ day, ...tally })}\n`);
}
