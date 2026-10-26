import { z } from 'zod';

/**
 * A deliberately narrow address: lower case, ASCII, dot-separated labels. Anything the pattern
 * refuses (a display name, a space, a line break, a quoted local part) is refused rather than
 * repaired. It is written to mean the same in JavaScript and in Postgres, and the CHECKs on the
 * stored addresses use this exact string.
 */
export const emailAddressPattern = String.raw`^[a-z0-9._%+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`;

export const maxEmailAddressLength = 254;

export const EmailAddressSchema = z
  .string()
  .max(maxEmailAddressLength)
  .regex(new RegExp(emailAddressPattern));

/** Case is the one thing folded, so a suppression written for one spelling holds for all. */
export function normalizeEmailAddress(raw: string): string {
  return raw.toLowerCase();
}

/** `Ramble <hello@example.com>` or a bare address; the name takes no angle brackets or quotes. */
export const EmailSenderSchema = z
  .string()
  .max(maxEmailAddressLength + 84)
  .refine((value) => {
    const named = /^[A-Za-z0-9 .,&-]{1,80} <([^<>\s]+)>$/.exec(value);
    return EmailAddressSchema.safeParse(named?.[1] ?? value).success;
  });

const maxAllowlistEntries = 50;

const AllowlistEntrySchema = z.union([
  EmailAddressSchema,
  z
    .string()
    .max(maxEmailAddressLength)
    .regex(
      /^@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/,
    ),
]);

/** Comma-separated addresses or `@domain` entries, as read from `EMAIL_ALLOWLIST`. */
export const EmailAllowlistSchema = z
  .string()
  .max(maxAllowlistEntries * (maxEmailAddressLength + 1))
  .transform((raw) =>
    raw === '' ? [] : raw.split(',').map((entry) => entry.trim().toLowerCase()),
  )
  .pipe(z.array(AllowlistEntrySchema).max(maxAllowlistEntries));

/** An `@domain` entry matches that exact domain only, never a subdomain or a longer name. */
export function isAllowlisted(
  address: string,
  entries: readonly string[],
): boolean {
  const domain = address.slice(address.lastIndexOf('@'));
  return entries.some((entry) => entry === address || entry === domain);
}
