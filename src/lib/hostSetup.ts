import { z } from 'zod';
import { SlugSchema, WriteIdSchema } from './catalog';
import {
  EmailAddressSchema,
  maxEmailAddressLength,
  normalizeEmailAddress,
} from './email/address';
import { pauseNoticeOf } from './experiencePause';
import {
  changedFields,
  fieldsFromIssues,
  formText,
  inFieldOrder,
  inviteFailureNotices,
  invalidFormNotice,
  inviteNoticeFor,
  noticeText,
  oversizedFields,
  parseNotice,
  slugFor,
  type FormGetter,
  type InviteResult,
  type NoticeText,
} from './opsForm';
import { isKnownTimeZone, maxTimeZoneLength, TimeZoneSchema } from './sessions';
import { requiredText } from './text';
import { zonedDayLabel } from './zonedLabels';

// Host setup for ops: the host record, its owner, and the one agreement acceptance. The database
// CHECKs on `hosts` repeat these limits (migration `host_record_limits`).

export const hostLimits = {
  name: 120,
  slug: 80,
  description: 2000,
  /** A field longer than this is refused unread, so no rule walks an unbounded string. */
  rawField: 4000,
} as const;

/** The legal document a host accepts at onboarding; its content-rights terms are part of it. */
export const hostAgreementDoc = 'host-agreement';

export const hostsPath = '/ops/hosts';
export const newHostPath = '/ops/hosts/new';

export function hostPath(hostId: string): string {
  return `${hostsPath}/${hostId}`;
}

const hostEditableFields = [
  'name',
  'slug',
  'description',
  'timeZone',
  'notificationEmail',
] as const;
export type HostEditableField = (typeof hostEditableFields)[number];

export const hostFormFields = [
  ...hostEditableFields,
  'ownerEmail',
  'acceptLegalDocumentId',
] as const;
export type HostFormField = (typeof hostFormFields)[number];

export type HostInput = {
  name: string;
  slug: string;
  description: string | null;
  timeZone: string;
  notificationEmail: string | null;
};

export type HostCreateInput = HostInput & {
  ownerEmail: string;
  /** The agreement version the person saw and ticked; null when the box was left empty. */
  acceptedLegalDocumentId: string | null;
};

export type HostFormResult<T> =
  { ok: true; value: T } | { ok: false; fields: HostFormField[] };

const optionalEmail = z
  .string()
  .max(maxEmailAddressLength)
  .transform(normalizeEmailAddress)
  .pipe(EmailAddressSchema);

const FieldsSchema = z.strictObject({
  name: requiredText(hostLimits.name),
  slug: SlugSchema.optional(),
  description: requiredText(hostLimits.description).optional(),
  timeZone: z
    .string()
    .max(maxTimeZoneLength)
    .pipe(TimeZoneSchema)
    .refine(isKnownTimeZone, { message: 'A time zone name' }),
  notificationEmail: optionalEmail.optional(),
  ownerEmail: optionalEmail.optional(),
});

/**
 * Reads `fields` from a posted form and parses them with `schema`. A field over the raw limit is
 * refused unread (`sized` names the fields whose size is checked), and
 * every field the schema refuses is named, in the list's order.
 */
function readTextFields<
  Field extends HostFormField,
  Schema extends z.ZodType,
  Sized extends HostFormField,
>(
  get: FormGetter,
  fields: readonly Field[],
  schema: Schema,
  sized: readonly Sized[],
):
  | { ok: true; data: z.output<Schema> }
  | { ok: false; fields: (Field | Sized)[] } {
  const oversized = oversizedFields(get, sized, hostLimits.rawField);
  if (oversized.length > 0) return { ok: false, fields: oversized };
  const parsed = schema.safeParse(
    Object.fromEntries(fields.map((field) => [field, formText(get, field)])),
  );
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, fields: fieldsFromIssues(parsed.error.issues, fields) };
}

function parseFields(
  get: FormGetter,
  options: { requireOwner: boolean; deriveSlug: boolean },
): HostFormResult<HostInput & { ownerEmail: string | null }> {
  const parsed = readTextFields(
    get,
    [...hostEditableFields, 'ownerEmail'] as const,
    FieldsSchema,
    hostFormFields,
  );
  const failed = new Set<HostFormField>();
  if (!parsed.ok) return parsed;
  const { data } = parsed;
  const slug = slugFor(
    data.name,
    data.slug,
    options.deriveSlug,
    hostLimits.slug,
  );
  if (slug !== null) failed.delete('slug');
  else failed.add('slug');
  if (options.requireOwner && data.ownerEmail === undefined) {
    failed.add('ownerEmail');
  }
  if (failed.size > 0) {
    return { ok: false, fields: inFieldOrder(hostFormFields, failed) };
  }
  return {
    ok: true,
    value: {
      name: data.name,
      slug: slug ?? '',
      description: data.description ?? null,
      timeZone: data.timeZone,
      notificationEmail: data.notificationEmail ?? null,
      ownerEmail: data.ownerEmail ?? null,
    },
  };
}

/** The create form: an owner address is required, and a blank slug comes from the name. */
export function parseHostCreateForm(
  get: FormGetter,
): HostFormResult<HostCreateInput> {
  const fields = parseFields(get, { requireOwner: true, deriveSlug: true });
  if (!fields.ok) return fields;
  // A ticked box names the version it was shown; one that does not is a bad form, never "not ticked".
  const ticked = get('acceptLegalDocumentId');
  const accepted = WriteIdSchema.safeParse(ticked);
  if (
    !accepted.success &&
    ticked !== undefined &&
    ticked !== null &&
    ticked !== ''
  ) {
    return { ok: false, fields: ['acceptLegalDocumentId'] };
  }
  const { ownerEmail, ...host } = fields.value;
  return {
    ok: true,
    value: {
      ...host,
      ownerEmail: ownerEmail ?? '',
      acceptedLegalDocumentId: accepted.success ? accepted.data : null,
    },
  };
}

/** The edit form: the slug is shown filled in, so a blank one is an error and never a silent rename. */
export function parseHostEditForm(get: FormGetter): HostFormResult<HostInput> {
  const fields = parseFields(get, { requireOwner: false, deriveSlug: false });
  if (!fields.ok) return fields;
  const { name, slug, description, timeZone, notificationEmail } = fields.value;
  return {
    ok: true,
    value: { name, slug, description, timeZone, notificationEmail },
  };
}

/** What a host owner edits on their own host: the name and about text guests see, and where booking emails go. The slug and time zone stay with ops. */
export const hostSettingsFields = [
  'name',
  'description',
  'notificationEmail',
] as const satisfies readonly HostEditableField[];
export type HostSettingsField = (typeof hostSettingsFields)[number];
export type HostSettingsInput = Pick<HostInput, HostSettingsField>;

/** The settings form, read with the ops form's own limits and parsers. A field it refuses is named, and nothing posted beyond its three fields is read. */
export function parseHostSettingsForm(
  get: FormGetter,
):
  | { ok: true; value: HostSettingsInput }
  | { ok: false; fields: HostSettingsField[] } {
  const parsed = readTextFields(
    get,
    hostSettingsFields,
    FieldsSchema.pick({
      name: true,
      description: true,
      notificationEmail: true,
    }),
    hostSettingsFields,
  );
  if (!parsed.ok) return parsed;
  const { name, description, notificationEmail } = parsed.data;
  return {
    ok: true,
    value: {
      name,
      description: description ?? null,
      notificationEmail: notificationEmail ?? null,
    },
  };
}

/** Which settings differ, in form order. Nothing differing means nothing is written. */
export function changedHostSettings(
  before: HostSettingsInput,
  after: HostSettingsInput,
): HostSettingsField[] {
  return changedFields(hostSettingsFields, before, after);
}

/** What a save came to: nothing differing is `unchanged`, anything else `updated`. */
export function hostSaveOutcome(
  changed: readonly unknown[],
): 'updated' | 'unchanged' {
  return changed.length === 0 ? 'unchanged' : 'updated';
}

/** Which editable fields differ, in form order. Nothing differing means nothing is written. */
export function changedHostFields(
  before: HostInput,
  after: HostInput,
): HostEditableField[] {
  return changedFields(hostEditableFields, before, after);
}

export type HostAcceptanceOutcome =
  'recorded' | 'already_accepted' | 'stale' | 'no_current_document';

/**
 * What accepting does. The person accepts the version they were shown, so a newer one published
 * since is `stale` and records nothing; accepting the current version twice records nothing twice.
 */
export function decideHostAcceptance(input: {
  currentId: string | null;
  submittedId: string | null;
  acceptedIds: readonly string[];
}): HostAcceptanceOutcome {
  if (input.currentId === null) return 'no_current_document';
  if (input.submittedId !== input.currentId) return 'stale';
  return input.acceptedIds.includes(input.currentId)
    ? 'already_accepted'
    : 'recorded';
}

/** The outcomes that refuse the whole setup: a version that is not current cannot be accepted. */
export function agreementRefusal(
  outcome: HostAcceptanceOutcome,
): 'stale' | 'no_current_document' | null {
  return outcome === 'stale' || outcome === 'no_current_document'
    ? outcome
    : null;
}

/** Whether a database error is the unique index on host slugs refusing a second host with one. */
export function isSlugTakenError(error: unknown): boolean {
  const cause =
    typeof error === 'object' && error !== null && 'cause' in error
      ? error.cause
      : error;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === '23505' &&
    'constraint' in cause &&
    cause.constraint === 'hosts_slug_unique'
  );
}

export type HostAcceptanceState =
  'accepted' | 'outdated' | 'missing' | 'no_document';

/** The zone the new-host form starts on. */
export const defaultHostTimeZone = 'America/New_York';

/** The sentence beside the box that says the host accepted the current agreement. */
export function agreementTickLabel(agreement: {
  title: string;
  version: number;
}): string {
  return `The host has accepted the current ${agreement.title} (version ${String(agreement.version)}), which includes the content-rights terms.`;
}

/** The sentence above the button that records an acceptance on a host's page. */
export function agreementRecordPrompt(agreement: {
  title: string;
  version: number;
}): string {
  return `Record that this host accepted the current ${agreement.title}, version ${String(agreement.version)}, which includes the content-rights terms.`;
}

/** Where a host stands against the current agreement: accepted it, accepted an older one, accepted none, or there is none to accept. */
export function hostAcceptanceState(input: {
  currentId: string | null;
  acceptedIds: readonly string[];
}): HostAcceptanceState {
  if (input.currentId === null) return 'no_document';
  if (input.acceptedIds.includes(input.currentId)) return 'accepted';
  return input.acceptedIds.length > 0 ? 'outdated' : 'missing';
}

export const acceptanceLabels = {
  accepted: 'Accepted',
  outdated: 'Older version accepted',
  missing: 'Not accepted',
  no_document: 'No agreement published',
} as const satisfies Record<HostAcceptanceState, string>;

export const acceptanceTones = {
  accepted: 'success',
  outdated: 'warning',
  missing: 'warning',
  no_document: 'neutral',
} as const satisfies Record<
  HostAcceptanceState,
  'success' | 'warning' | 'neutral'
>;

type OwnerRow = {
  hostId: string | null;
  userId: string;
  email: string;
};

type HostRowFields = {
  id: string;
  name: string;
  slug: string;
  timeZone: string;
};

type AcceptanceRow = HostAcceptanceRecord & { hostId: string };

/** The hosts a page lists, each with its owners' addresses and where it stands against the current agreement. */
export function buildHostListRows(input: {
  hosts: readonly HostRowFields[];
  owners: readonly OwnerRow[];
  acceptances: readonly AcceptanceRow[];
  currentAgreementId: string | null;
}): HostListRow[] {
  return input.hosts.map((host) => ({
    id: host.id,
    name: host.name,
    slug: host.slug,
    timeZone: host.timeZone,
    ownerEmails: input.owners
      .filter((owner) => owner.hostId === host.id)
      .map((owner) => owner.email),
    acceptance: hostAcceptanceState({
      currentId: input.currentAgreementId,
      acceptedIds: input.acceptances
        .filter((record) => record.hostId === host.id)
        .map((record) => record.legalDocumentId),
    }),
  }));
}

/** One host as its page shows it. */
export function buildHostDetail(input: {
  host: HostRowFields & {
    description: string | null;
    notificationEmail: string | null;
  };
  owners: readonly OwnerRow[];
  acceptances: readonly AcceptanceRow[];
  agreement: { id: string; version: number; title: string } | null;
}): HostDetail {
  const { host } = input;
  const acceptances = input.acceptances.filter(
    (record) => record.hostId === host.id,
  );
  return {
    acceptance: hostAcceptanceState({
      currentId: input.agreement?.id ?? null,
      acceptedIds: acceptances.map((record) => record.legalDocumentId),
    }),
    host: {
      id: host.id,
      name: host.name,
      slug: host.slug,
      description: host.description,
      timeZone: host.timeZone,
      notificationEmail: host.notificationEmail,
    },
    owners: input.owners
      .filter((owner) => owner.hostId === host.id)
      .map(({ userId, email }) => ({ userId, email })),
    agreement: input.agreement
      ? {
          id: input.agreement.id,
          version: input.agreement.version,
          title: input.agreement.title,
        }
      : null,
    acceptances: acceptances.map(
      ({ legalDocumentId, version, acceptedAt }) => ({
        legalDocumentId,
        version,
        acceptedAt,
      }),
    ),
  };
}

export type HostListRow = {
  id: string;
  name: string;
  slug: string;
  timeZone: string;
  ownerEmails: string[];
  acceptance: HostAcceptanceState;
};

type HostOwner = { userId: string; email: string };

export type HostAcceptanceRecord = {
  legalDocumentId: string;
  version: number;
  acceptedAt: Date;
};

export type HostDetail = {
  acceptance: HostAcceptanceState;
  host: HostInput & { id: string };
  owners: HostOwner[];
  agreement: { id: string; version: number; title: string } | null;
  acceptances: HostAcceptanceRecord[];
};

/** One line saying which version a record is and when it was accepted, in the host's own zone. */
export function acceptanceRecordLabel(
  record: HostAcceptanceRecord,
  timeZone: string,
): string {
  return `Version ${String(record.version)}, accepted ${zonedDayLabel(record.acceptedAt, timeZone)}`;
}

export const hostFieldProblems = {
  name: 'Enter the host name, up to 120 characters.',
  slug: 'Use lower-case words joined by hyphens, up to 80 characters, that no other host uses.',
  description: 'Keep the description under 2000 characters, or leave it empty.',
  timeZone: 'Enter a time zone name such as America/New_York.',
  notificationEmail: 'Enter an email address, like bookings@example.com.',
  ownerEmail: 'Enter the owner email address, like name@example.com.',
  acceptLegalDocumentId:
    'The agreement version could not be read. Reload the form and try again.',
} as const satisfies Record<HostFormField, string>;

export const hostNoticeCodes = [
  'created',
  'created_invite_failed',
  'updated',
  'unchanged',
  'accepted',
  'already_accepted',
  'invited',
  'invite_failed',
  'rate_limited',
  'stale_agreement',
  'no_agreement',
  'invalid',
  'slug_taken',
] as const;
export type HostNoticeCode = (typeof hostNoticeCodes)[number];

export const hostNotices = {
  created: {
    tone: 'success',
    title: 'Host created. A sign-in link is on its way to the owner.',
  },
  created_invite_failed: {
    tone: 'warning',
    title:
      'Host created, but the sign-in link could not be sent. Send it again below.',
  },
  updated: { tone: 'success', title: 'Host saved.' },
  unchanged: {
    tone: 'info',
    title: 'Nothing was different, so nothing was saved.',
  },
  accepted: { tone: 'success', title: 'Agreement acceptance recorded.' },
  already_accepted: {
    tone: 'info',
    title: 'This host has already accepted the current agreement.',
  },
  invited: { tone: 'success', title: 'Sign-in link sent to the owner.' },
  ...inviteFailureNotices,
  stale_agreement: {
    tone: 'warning',
    title:
      'A newer agreement was published while you were looking. Review it and try again.',
  },
  no_agreement: {
    tone: 'warning',
    title: 'There is no published host agreement to accept yet.',
  },
  invalid: invalidFormNotice,
  slug_taken: {
    tone: 'danger',
    title:
      'Another host already uses that address name. Choose a different one.',
  },
} as const satisfies Record<HostNoticeCode, NoticeText>;

const createdInviteNotices = {
  sent: 'created',
  rate_limited: 'rate_limited',
  failed: 'created_invite_failed',
  not_found: 'created_invite_failed',
} as const satisfies Record<InviteResult, HostNoticeCode>;

const resentInviteNotices = {
  sent: 'invited',
  rate_limited: 'rate_limited',
  failed: 'invite_failed',
  not_found: 'invite_failed',
} as const satisfies Record<InviteResult, HostNoticeCode>;

/** What the invite action tells the person after the host is made or the link is sent again. A host or owner that is gone is a failure to send. */
export function inviteNotice(
  result: InviteResult,
  afterCreate: boolean,
): HostNoticeCode {
  return inviteNoticeFor(
    result,
    afterCreate ? createdInviteNotices : resentInviteNotices,
  );
}

const agreementNotices = {
  recorded: 'accepted',
  already_accepted: 'already_accepted',
  stale: 'stale_agreement',
  no_current_document: 'no_agreement',
} as const satisfies Record<HostAcceptanceOutcome, HostNoticeCode>;

/** What the person is told after an acceptance was tried. */
export function agreementNotice(
  outcome: HostAcceptanceOutcome,
): HostNoticeCode {
  return agreementNotices[outcome];
}

/** The owner column: the addresses, or a word for a host nobody owns yet. */
export function ownerCellLabel(emails: readonly string[]): string {
  return emails.length > 0 ? emails.join(', ') : 'None';
}

/** What the host page shows for its address: the notice of the last save, agreement, invite, suspension or unsuspension. */
export function hostPageNotice(
  raw: string | readonly string[] | undefined,
): NoticeText | null {
  return (
    noticeText(hostNotices, parseNotice(raw, hostNoticeCodes)) ??
    pauseNoticeOf(raw)
  );
}
