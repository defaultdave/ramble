// The PII inventory (PRD-73, design doc section 6): every personal-data column Ramble stores, every
// vendor that holds personal data, and how long each kind is kept. Later units add a row here when
// they add a column, and anonymizeGuest gets a step for each table that holds a person's data.

export type PiiColumn = {
  table: string;
  column: string;
  /** `identifier`: the value is itself personal data (an email). `link`: it points at a person and carries nothing else. */
  kind: 'identifier' | 'link';
  data: string;
  /** Where the value lives. */
  location: string;
  /** What the anonymize function does to it, or why nothing needs to happen. */
  deletionPath: string;
};

const databaseLocation = 'Neon Postgres, US East (ADR 0002, ADR 0007)';

export const piiColumns: readonly PiiColumn[] = [
  {
    table: 'guests',
    column: 'email',
    kind: 'identifier',
    data: "A guest's email address, folded to lower case",
    location: databaseLocation,
    deletionPath:
      'anonymizeGuest replaces it with an address derived from the row id on the reserved domain anonymized.invalid',
  },
  {
    table: 'consents',
    column: 'guest_id',
    kind: 'link',
    data: 'Which guest granted or withdrew a consent',
    location: databaseLocation,
    deletionPath:
      'Rows stay, as the record that a consent existed and when it ended; the guest they point at is anonymized. anonymizeGuest also withdraws every consent still granted, with source erasure',
  },
  {
    table: 'privacy_requests',
    column: 'guest_id',
    kind: 'link',
    data: 'Which guest asked for access or deletion',
    location: databaseLocation,
    deletionPath:
      'Rows stay, as the record that a request was made and when; the guest they point at is anonymized',
  },
  {
    table: 'messages',
    column: 'recipient',
    kind: 'identifier',
    data: 'The address an email was sent to',
    location: databaseLocation,
    deletionPath:
      "Not yet anonymized: the privacy-requests work adds a message log step to anonymizeGuest, keyed on the guest's address",
  },
  {
    table: 'messages',
    column: 'html',
    kind: 'identifier',
    data: 'The rendered email, kept only for the fake adapter (the dev mailbox)',
    location: databaseLocation,
    deletionPath:
      'Not yet anonymized: the privacy-requests work adds a message log step; a real send keeps no body',
  },
  {
    table: 'messages',
    column: 'text_body',
    kind: 'identifier',
    data: 'The plain-text email, kept only for the fake adapter (the dev mailbox)',
    location: databaseLocation,
    deletionPath:
      'Not yet anonymized: the privacy-requests work adds a message log step; a real send keeps no body',
  },
  {
    table: 'email_suppressions',
    column: 'address',
    kind: 'identifier',
    data: 'An address a hard bounce or spam complaint closed',
    location: databaseLocation,
    deletionPath:
      'Kept on purpose after a deletion request, so Ramble never mails an address that complained; the privacy-requests work decides whether it is hashed',
  },
  {
    table: 'messages',
    column: 'idempotency_key',
    kind: 'link',
    data: 'A key the sender builds from the ids of the records an email is about',
    location: databaseLocation,
    deletionPath:
      'Holds record ids, not an address or a name; kept with the message row. The privacy-requests work confirms no key embeds an address',
  },
  {
    table: 'messages',
    column: 'failure_reason',
    kind: 'identifier',
    data: "A provider's error text for a failed send, cut to 500 characters, which can repeat the recipient address",
    location: databaseLocation,
    deletionPath:
      "Not yet anonymized: the privacy-requests work adds the message log's step, which clears it",
  },
  {
    table: 'rate_limits',
    column: 'key',
    kind: 'identifier',
    data: 'A surface name and a SHA-256 of the subject: an email for sign-in links, an address plus a form name for forms, a device key, hold id, or token for the others. A hash of an email can be reversed by guessing, so it counts as personal data',
    location: databaseLocation,
    deletionPath:
      'No anonymize step: a row is dead at expires_at (windows are at most one hour) and the purge removes it, so nothing outlives its window',
  },
  {
    table: 'jobs',
    column: 'payload',
    kind: 'link',
    data: 'The ids of the rows a job works on (an order id for the guest and host emails); a handler reads any address from the row',
    location: databaseLocation,
    deletionPath:
      'Finished jobs are purged on a schedule; a job kind that puts an address or a name in its payload must be added here with its own step',
  },
  {
    table: 'jobs',
    column: 'dedupe_key',
    kind: 'link',
    data: 'A key built from record ids so a job is queued once',
    location: databaseLocation,
    deletionPath: 'Removed with the job when finished jobs are purged',
  },
  {
    table: 'legal_acceptances',
    column: 'subject_id',
    kind: 'link',
    data: 'The order or host that accepted a document',
    location: databaseLocation,
    deletionPath:
      'Rows stay as the proof of acceptance (the records a deletion request may not remove); the order or host they point at is anonymized by its own step',
  },
  {
    table: 'photos',
    column: 'rights_holder',
    kind: 'identifier',
    data: 'The name of the photographer or company that holds the rights to a host photo',
    location: databaseLocation,
    deletionPath:
      'Not a guest. Kept as the rights record while the photo is published; ops edits or removes it with the photo',
  },
];

const notPersonal = (
  table: string,
  reason: string,
  columns: readonly string[],
) => columns.map((column) => ({ table, column, reason }));

const aRandomId = 'A random uuid';
const aFixedList = 'A fixed list of values';
const aTime = 'A time';
const aCountOrTime = 'A count or a time';
const publishedCopy =
  'Copy written by Ramble staff and published to every guest';
const structure =
  'A reference to another row, or a number or flag, with no text';

/**
 * Every column that holds no personal data, with the reason. A test requires every column of every
 * table in the schema to be here or in `piiColumns`, once, so a new column fails until it is
 * classified.
 */
export const nonPiiColumns: readonly {
  table: string;
  column: string;
  reason: string;
}[] = [
  ...notPersonal('guests', aRandomId, ['id']),
  ...notPersonal(
    'guests',
    'A time, with no link to a person once the email is anonymized',
    ['created_at'],
  ),
  ...notPersonal('guests', 'The time of the erasure', ['anonymized_at']),
  ...notPersonal('consents', aRandomId, ['id']),
  ...notPersonal('consents', aFixedList, ['kind', 'status', 'source']),
  ...notPersonal('consents', aTime, ['recorded_at']),
  ...notPersonal('privacy_requests', aRandomId, ['id']),
  ...notPersonal('privacy_requests', aFixedList, ['kind', 'status']),
  ...notPersonal('privacy_requests', aTime, ['created_at', 'resolved_at']),
  ...notPersonal('messages', aRandomId, ['id']),
  ...notPersonal(
    'messages',
    'Fixed per template today: the subject line takes no data. A template that puts a name in it moves this column to the personal list',
    ['subject'],
  ),
  ...notPersonal('messages', aFixedList, ['template', 'status', 'adapter']),
  ...notPersonal('messages', "The provider's own id for the message", [
    'provider_message_id',
  ]),
  ...notPersonal('messages', 'A count', ['attempts']),
  ...notPersonal('messages', aTime, ['created_at', 'updated_at']),
  ...notPersonal('email_suppressions', aFixedList, ['reason']),
  ...notPersonal('email_suppressions', structure, ['source_message_id']),
  ...notPersonal('email_suppressions', aTime, ['created_at']),
  ...notPersonal('rate_limits', aCountOrTime, [
    'count',
    'window_started_at',
    'expires_at',
  ]),
  ...notPersonal('jobs', aRandomId, ['id']),
  ...notPersonal('jobs', 'The job type, from a registry in code', ['kind']),
  ...notPersonal('jobs', aFixedList, ['status']),
  ...notPersonal('jobs', aCountOrTime, [
    'attempts',
    'max_attempts',
    'run_after',
    'locked_until',
    'created_at',
    'finished_at',
  ]),
  ...notPersonal(
    'jobs',
    'The error kind and a message the logger redaction list has cleaned, cut to 2000 characters',
    ['last_error'],
  ),
  ...notPersonal('legal_acceptances', aRandomId, ['id']),
  ...notPersonal('legal_acceptances', structure, ['legal_document_id']),
  ...notPersonal('legal_acceptances', aFixedList, ['subject_kind']),
  ...notPersonal('legal_acceptances', aTime, ['accepted_at']),
  ...notPersonal('legal_documents', publishedCopy, ['doc', 'title', 'body']),
  ...notPersonal('legal_documents', aRandomId, ['id']),
  ...notPersonal('legal_documents', 'A number, a fixed list, or a time', [
    'version',
    'status',
    'published_at',
    'created_at',
  ]),
  ...notPersonal('settings', 'Ops switches and numbers; a single row', [
    'id',
    'banner_text',
    'bookings_paused',
    'gifts_enabled',
    'checkout_maintenance',
    'hold_minutes',
    'payment_grace_minutes',
    'gift_validity_months',
    'gift_expiry_action',
    'tax_rate_ppm',
    'updated_at',
  ]),
  ...notPersonal('cancellation_tiers', 'Policy configuration', [
    'id',
    'key',
    'name',
    'full_refund_hours_before',
    'is_default',
  ]),
  ...notPersonal(
    'hosts',
    'A host business as published on its listings; hosts are suppliers, and no guest data lives here',
    ['id', 'slug', 'name', 'description', 'time_zone', 'created_at'],
  ),
  ...notPersonal('categories', publishedCopy, ['id', 'slug', 'name']),
  ...notPersonal('neighborhoods', publishedCopy, ['id', 'slug', 'name']),
  ...notPersonal('experiences', publishedCopy, [
    'slug',
    'name',
    'description',
    'meeting_point',
    'included',
    'accessibility_notes',
    'link_out_url',
    'affiliate_url',
  ]),
  ...notPersonal('experiences', structure, [
    'id',
    'host_id',
    'category_id',
    'neighborhood_id',
    'cancellation_tier_id',
    'duration_minutes',
    'outdoor',
    'weather_decision_hours',
    'min_age',
    'max_age',
    'waiver_required',
    'waiver_document_id',
    'created_at',
  ]),
  ...notPersonal('experiences', aFixedList, [
    'status',
    'weather_policy',
    'age_rule',
    'tax_treatment',
  ]),
  ...notPersonal('price_options', structure, [
    'id',
    'experience_id',
    'kind',
    'price_minor',
    'uses_space',
  ]),
  ...notPersonal('photos', publishedCopy, ['alt_text', 'url', 'storage_key']),
  ...notPersonal('photos', structure, [
    'id',
    'experience_id',
    'position',
    'width',
    'height',
    'byte_size',
    'decorative',
    'blur_data_url',
    'created_at',
  ]),
  ...notPersonal('photos', 'The rights record of a photo, not a person', [
    'rights_basis',
    'rights_license',
    'rights_source_url',
  ]),
  ...notPersonal('slug_history', 'A retired public address of a page', [
    'id',
    'entity_kind',
    'entity_id',
    'slug',
    'retired_at',
  ]),
  ...notPersonal('session_templates', structure, [
    'id',
    'experience_id',
    'weekday',
    'start_time',
    'duration_minutes',
    'allocation',
    'source',
    'created_at',
  ]),
  ...notPersonal('sessions', structure, [
    'id',
    'experience_id',
    'template_id',
    'local_date',
    'starts_at',
    'ends_at',
    'time_zone',
    'allocation',
    'seats_sold',
    'status',
    'source',
    'version',
  ]),
  ...notPersonal(
    'sessions',
    'A reason ops gives for cancelling a session, written about the session and not a guest',
    ['cancel_reason'],
  ),
  ...notPersonal('collections', publishedCopy, [
    'id',
    'kind',
    'slug',
    'title',
    'summary',
    'intro',
    'status',
    'published_at',
    'created_at',
    'updated_at',
  ]),
  ...notPersonal('collection_items', publishedCopy, [
    'id',
    'collection_id',
    'experience_id',
    'position',
    'note',
  ]),
  ...notPersonal('help_articles', publishedCopy, [
    'id',
    'slug',
    'title',
    'summary',
    'body',
    'position',
    'status',
    'published_at',
    'created_at',
    'updated_at',
  ]),
  ...notPersonal('home_modules', publishedCopy, [
    'id',
    'position',
    'kind',
    'enabled',
    'heading',
    'body',
    'collection_id',
    'collection_kind',
  ]),
  ...notPersonal('pages', publishedCopy, [
    'id',
    'category_id',
    'neighborhood_id',
    'heading',
    'meta_description',
    'intro',
    'body',
    'status',
    'published_at',
    'updated_at',
  ]),
];

export type PiiVendor = {
  name: string;
  /** The job it does for Ramble. */
  purpose: string;
  data: string;
  location: string;
  deletionPath: string;
  /** The demo runs without most of these (fake adapters, ADR 0003 and 0007); they matter for the real job. */
  stage: 'demo' | 'real_job';
};

export const piiVendors: readonly PiiVendor[] = [
  {
    name: 'Neon',
    purpose: 'Postgres, the one store for every table',
    data: 'Every column in the inventory above, plus backups and branches of the database',
    location: 'US East (ADR 0002, ADR 0007)',
    deletionPath:
      'The anonymize function for live rows; Neon history and preview branches expire on their own schedule (previews after 7 days, ADR 0007)',
    stage: 'demo',
  },
  {
    name: 'Cloudflare R2',
    purpose: 'Hourly database dump for recovery (PRD-75)',
    data: 'A full copy of the database, including every column in the inventory',
    location: 'A region other than US East (ADR 0002)',
    deletionPath:
      'Dumps are deleted when they age out; a deletion request cannot reach into an existing dump, so a restore must re-run every anonymization made since the dump',
    stage: 'real_job',
  },
  {
    name: 'Vercel',
    purpose:
      'Hosting, request logs, Web Analytics and Speed Insights on guest pages',
    data: 'IP addresses and request paths in platform logs; page-view counts with no account',
    location: 'Functions in US East (ADR 0007)',
    deletionPath:
      'Platform log retention; nothing keyed to a guest is sent, so there is no per-person deletion',
    stage: 'demo',
  },
  {
    name: 'Vercel Blob',
    purpose: 'Photos and private host documents',
    data: 'Host photos and documents; no guest data',
    location: 'Vercel storage region chosen at store creation',
    deletionPath: 'Holds no guest data, so no guest deletion applies',
    stage: 'demo',
  },
  {
    name: 'Stripe',
    purpose: 'Card payments and refunds (the fake gateway in the demo)',
    data: 'Cardholder name, email, card details, and payment history for each charge',
    location: 'Stripe, United States',
    deletionPath:
      "Stripe keeps payment records it must by law; a deletion request is passed on through Stripe's customer deletion and the records kept are the ones PRD-73 allows",
    stage: 'real_job',
  },
  {
    name: 'Resend',
    purpose: 'Transactional email (the dev mailbox in the demo)',
    data: 'Recipient address, subject, and delivery status of each message',
    location: 'Resend, United States',
    deletionPath:
      "Resend's message log retention; the address can be deleted from Resend's suppression and event records on request",
    stage: 'real_job',
  },
  {
    name: 'Sentry',
    purpose: 'Server error capture (never on checkout in the browser)',
    data: 'Error reports; Ramble scrubs request bodies and personal fields before sending',
    location: 'Sentry, United States',
    deletionPath: 'Sentry event retention; events hold no email by design',
    stage: 'demo',
  },
  {
    name: 'Axiom',
    purpose: 'Warning and error logs beyond the platform window',
    data: 'Structured log lines with request ids; the logger redacts personal fields',
    location: 'Axiom, United States',
    deletionPath: 'Axiom dataset retention; log lines hold no email by design',
    stage: 'demo',
  },
  {
    name: 'Better Stack',
    purpose: 'Uptime checks, heartbeats, and the status page',
    data: 'Monitor URLs and subscribers to status updates, if any are added',
    location: 'Better Stack, region set per account',
    deletionPath:
      'Remove a status-page subscriber in the Better Stack dashboard',
    stage: 'demo',
  },
  {
    name: 'Newsletter platform (not chosen yet)',
    purpose:
      'Holds subscribers for the newsletter that sends traffic to Ramble (PRD-58)',
    data: 'Subscriber address and click history',
    location: 'To confirm when the platform is named',
    deletionPath:
      'Unsubscribe and delete the subscriber in the platform; Ramble records the withdrawal as a consent row',
    stage: 'real_job',
  },
];

// Retention periods wait for counsel (PRD Q-16, no lawyer engaged yet), so none is a number yet. A
// number goes in as `{ status: 'set', months }` with the answer; nothing else in the code changes.
export type RetentionPeriod =
  | { status: 'pending_counsel'; question: 'Q-16' }
  | { status: 'set'; months: number };

export type RetentionRow = {
  dataset: string;
  /** What the clock starts on. */
  startsAt: string;
  period: RetentionPeriod;
  note: string;
};

const pendingCounsel: RetentionPeriod = {
  status: 'pending_counsel',
  question: 'Q-16',
};

export const retentionSchedule: readonly RetentionRow[] = [
  {
    dataset: 'guests',
    startsAt: "The guest's last booking, or the row's creation if none",
    period: pendingCounsel,
    note: 'After the period the row is anonymized, not deleted, so records that point at it stay whole',
  },
  {
    dataset: 'consents',
    startsAt: "The row's recorded time",
    period: pendingCounsel,
    note: 'Kept as evidence of when a consent was given and ended',
  },
  {
    dataset: 'privacy_requests',
    startsAt: 'The time the request was resolved',
    period: pendingCounsel,
    note: 'Kept as the record that a request was made and how it ended',
  },
  {
    dataset: 'payment_tax_and_dispute_records',
    startsAt: 'The end of the tax year of the payment',
    period: pendingCounsel,
    note: 'PRD-73: kept to the minimum, access-limited, and never removed by a deletion request',
  },
];
