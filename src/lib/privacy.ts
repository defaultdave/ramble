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
];

/**
 * The columns that hold no personal data, each with the reason, for the tables whose every column
 * is classified. A table listed only in `piiColumns` has its personal columns inventoried and the
 * rest not yet classified.
 */
export const nonPiiColumns: readonly {
  table: string;
  column: string;
  reason: string;
}[] = [
  { table: 'guests', column: 'id', reason: 'A random uuid' },
  {
    table: 'guests',
    column: 'created_at',
    reason: 'A time, with no link to a person once the email is anonymized',
  },
  {
    table: 'guests',
    column: 'anonymized_at',
    reason: 'The time of the erasure',
  },
  { table: 'consents', column: 'id', reason: 'A random uuid' },
  { table: 'consents', column: 'kind', reason: 'A fixed list' },
  { table: 'consents', column: 'status', reason: 'A fixed list' },
  { table: 'consents', column: 'source', reason: 'A fixed list' },
  { table: 'consents', column: 'recorded_at', reason: 'A time' },
  { table: 'privacy_requests', column: 'id', reason: 'A random uuid' },
  { table: 'privacy_requests', column: 'kind', reason: 'A fixed list' },
  { table: 'privacy_requests', column: 'status', reason: 'A fixed list' },
  { table: 'privacy_requests', column: 'created_at', reason: 'A time' },
  { table: 'privacy_requests', column: 'resolved_at', reason: 'A time' },
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
