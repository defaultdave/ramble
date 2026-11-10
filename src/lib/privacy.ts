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
    table: 'hosts',
    column: 'notification_email',
    kind: 'identifier',
    data: "The address a host's booking and cancellation notices go to; a host's contact, never a guest's",
    location: databaseLocation,
    deletionPath:
      'Cleared when the host is offboarded (the host tools work); a host is a supplier, so a guest deletion request never reaches it',
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
    table: 'auth_users',
    column: 'email',
    kind: 'identifier',
    data: 'The address a person signed in with, folded to lower case',
    location: databaseLocation,
    deletionPath:
      'Not yet anonymized: the privacy-requests work (U-085) adds a step to anonymizeGuest that deletes the sign-in user and its sessions',
  },
  {
    table: 'auth_users',
    column: 'name',
    kind: 'identifier',
    data: 'A display name, empty unless a sign-in request supplied one',
    location: databaseLocation,
    deletionPath:
      'Not yet anonymized: deleted with the sign-in user by the privacy-requests work (U-085)',
  },
  {
    table: 'auth_verifications',
    column: 'value',
    kind: 'identifier',
    data: 'The address a sign-in link was sent to, until the link is used or lapses (5 minutes)',
    location: databaseLocation,
    deletionPath:
      'The row is deleted when the link is used. A link that is never used lapses but its row stays until a purge is built; the expiry job (a suggestion in the U-004a report) removes them',
  },
  {
    table: 'auth_sessions',
    column: 'user_id',
    kind: 'link',
    data: 'Which signed-in person a session belongs to',
    location: databaseLocation,
    deletionPath:
      'Deleted with the sign-in user (cascade) by the privacy-requests work (U-085)',
  },
  {
    table: 'auth_accounts',
    column: 'user_id',
    kind: 'link',
    data: 'Which signed-in person an account belongs to',
    location: databaseLocation,
    deletionPath:
      'Deleted with the sign-in user (cascade) by the privacy-requests work (U-085)',
  },
  {
    table: 'auth_accounts',
    column: 'account_id',
    kind: 'link',
    data: "The person's id at the sign-in method; for email links, none is written",
    location: databaseLocation,
    deletionPath:
      'Deleted with the sign-in user (cascade) by the privacy-requests work (U-085)',
  },
  {
    table: 'role_grants',
    column: 'user_id',
    kind: 'link',
    data: 'Which signed-in person holds a role',
    location: databaseLocation,
    deletionPath:
      'Deleted with the sign-in user (cascade); a role grant is access, not a record to keep (the audit log keeps who changed it)',
  },
  {
    table: 'jobs',
    column: 'payload',
    kind: 'identifier',
    data: "The ids of the rows a job works on (an order id for the guest and host emails); a handler reads any address from the row. The one exception is the ops notice, whose payload is the finished text of the email to Ramble: for a contact message that is the sender's name, address, and message",
    location: databaseLocation,
    deletionPath:
      'Finished jobs are purged on a schedule, which bounds how long an ops notice keeps its text; a job kind that puts an address or a name in its payload must be added here with its own step',
  },
  {
    table: 'support_requests',
    column: 'name',
    kind: 'identifier',
    data: 'The name a guest typed into the contact form',
    location: databaseLocation,
    deletionPath:
      "Not yet anonymized: the support queue work adds a step keyed on the sender's address, because a sender need not be a guest",
  },
  {
    table: 'support_requests',
    column: 'email',
    kind: 'identifier',
    data: 'The address a guest typed into the contact form, folded to lower case',
    location: databaseLocation,
    deletionPath:
      "Not yet anonymized: the support queue work adds a step keyed on the sender's address, because a sender need not be a guest",
  },
  {
    table: 'support_requests',
    column: 'message',
    kind: 'identifier',
    data: 'Free text a guest typed into the contact form, which can name a booking, a person, or anything else they chose to write',
    location: databaseLocation,
    deletionPath:
      "Not yet anonymized: the support queue work adds a step keyed on the sender's address, because a sender need not be a guest",
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
  {
    table: 'holds',
    column: 'device_key',
    kind: 'identifier',
    data: 'A SHA-256 of the guest device cookie, which marks one browser across visits',
    location: databaseLocation,
    deletionPath:
      "The hold upkeep replaces it with a fixed value 30 days after a hold is released (the row stays, because hold items and later orders point at it). Not yet purged on a converted hold: the privacy-requests work (U-085) adds the step that clears it for an erased guest. The cookie holds a random value, so the hash is a device marker, not an email, but it still singles out one person's browser",
  },
  {
    table: 'holds',
    column: 'ip_hash',
    kind: 'identifier',
    data: "A SHA-256 of the requester's IP address, the second key for hold limits. An address space is small enough to guess, so the hash counts as personal data",
    location: databaseLocation,
    deletionPath:
      'The hold upkeep replaces it with a fixed value 30 days after a hold is released. Not yet purged on a converted hold: the privacy-requests work (U-085) adds the step that clears it for an erased guest',
  },
  {
    table: 'orders',
    column: 'guest_id',
    kind: 'link',
    data: 'Which guest an order belongs to',
    location: databaseLocation,
    deletionPath:
      'The row stays as the booking and tax record (PRD-73); the guest it points at is anonymized',
  },
  ...(
    [
      ['contact_email', "The booker's email address, as typed at checkout"],
      ['contact_phone', "The booker's phone number, if given"],
      ['lead_guest_name', 'The name of the lead guest'],
      ['children_ages', "The ages of the children on a kids' booking"],
      ['guardian_name', "A child's parent or guardian's name"],
      ['guardian_contact', "A child's parent or guardian's contact details"],
    ] as const
  ).map(([column, data]): PiiColumn => ({
    table: 'orders',
    column,
    kind: 'identifier',
    data,
    location: databaseLocation,
    deletionPath:
      'Not yet anonymized: the privacy-requests work (U-085) adds an orders step to anonymizeGuest that clears it and keeps the booking and tax record',
  })),
  {
    table: 'gifts',
    column: 'buyer_guest_id',
    kind: 'link',
    data: 'Which guest bought a gift',
    location: databaseLocation,
    deletionPath:
      'The row stays as the gift and payment record (PRD-73); the guest it points at is anonymized',
  },
  ...(
    [
      [
        'recipient_name',
        'The name of the person a gift is for, as the buyer typed it',
      ],
      [
        'recipient_email',
        'The address a gift is sent to, as the buyer typed it',
      ],
      ['message', "The buyer's note to the recipient, which can name people"],
    ] as const
  ).map(([column, data]): PiiColumn => ({
    table: 'gifts',
    column,
    kind: 'identifier',
    data,
    location: databaseLocation,
    deletionPath:
      'Not yet anonymized: the privacy-requests work (U-085) adds a gifts step that clears it once the gift is redeemed or out of date, and keeps the gift and payment record. The recipient is not a guest, so U-085 also decides how a request from a recipient reaches it',
  })),
  {
    table: 'provider_events',
    column: 'payload',
    kind: 'identifier',
    data: "The payment provider's event body, trimmed, which can carry billing details of the payer",
    location: databaseLocation,
    deletionPath:
      'Not yet anonymized: the privacy-requests work (U-085) decides how long a body is kept; the ids and amounts the booking needs are also in their own columns',
  },
  {
    table: 'refunds',
    column: 'initiated_by',
    kind: 'link',
    data: 'The staff member who started a refund',
    location: databaseLocation,
    deletionPath:
      'Kept with the refund as the audit record of who acted; a staff member who leaves is handled by the staff-removal step, not a guest deletion',
  },
  {
    table: 'ledger_entries',
    column: 'created_by',
    kind: 'link',
    data: 'The staff member who posted a ledger row by hand',
    location: databaseLocation,
    deletionPath:
      'Kept with the row as the audit record of who acted; the ledger is append-only (PRD-74), and a staff member who leaves is handled by the staff-removal step, not a guest deletion',
  },
  {
    table: 'audit_log',
    column: 'actor_id',
    kind: 'link',
    data: 'The signed-in user (staff or host) who made a change',
    location: databaseLocation,
    deletionPath:
      'Kept with the row as the audit record of who acted; the log is insert-only (PRD-74) and, once switched on, its nightly export is write-once, so a staff member who leaves is handled by the staff-removal step, not a guest deletion. The table holds no guest id: a guest who acts by token is identified by the subject, and details hold ids, codes, and amounts only',
  },
];

const notPersonal = (
  table: string,
  reason: string,
  columns: readonly string[],
) => columns.map((column) => ({ table, column, reason }));

const aRandomId = 'A random uuid';
const neverWritten =
  'Always empty: Better Auth needs the column, and a CHECK refuses any value, so sign-in keeps no browser address, user agent, picture, or credential';
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
  ...notPersonal('support_requests', aRandomId, ['id']),
  ...notPersonal('support_requests', aFixedList, ['topic']),
  ...notPersonal('support_requests', aTime, ['created_at']),
  ...notPersonal('auth_users', aRandomId, ['id']),
  ...notPersonal('auth_users', 'A flag', ['email_verified']),
  ...notPersonal('auth_users', aTime, ['created_at', 'updated_at']),
  ...notPersonal('auth_users', neverWritten, ['image']),
  ...notPersonal('auth_sessions', neverWritten, ['ip_address', 'user_agent']),
  ...notPersonal('auth_accounts', neverWritten, [
    'access_token',
    'refresh_token',
    'id_token',
    'access_token_expires_at',
    'refresh_token_expires_at',
    'scope',
    'password',
  ]),
  ...notPersonal('auth_sessions', aRandomId, ['id']),
  ...notPersonal(
    'auth_sessions',
    'A random secret held in the cookie; it names no one without the user_id beside it',
    ['token'],
  ),
  ...notPersonal('auth_sessions', aTime, [
    'expires_at',
    'created_at',
    'updated_at',
  ]),
  ...notPersonal('auth_accounts', aRandomId, ['id']),
  ...notPersonal('auth_accounts', aFixedList, ['provider_id']),
  ...notPersonal('auth_accounts', aTime, ['created_at', 'updated_at']),
  ...notPersonal('auth_verifications', aRandomId, ['id']),
  ...notPersonal(
    'auth_verifications',
    'A keyed hash of a random token, with no address in it',
    ['identifier'],
  ),
  ...notPersonal('auth_verifications', aTime, [
    'expires_at',
    'created_at',
    'updated_at',
  ]),
  ...notPersonal('role_grants', aRandomId, ['id']),
  ...notPersonal('role_grants', aFixedList, ['role']),
  ...notPersonal('role_grants', structure, ['host_id']),
  ...notPersonal('role_grants', aTime, ['created_at']),
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
  ...notPersonal('holds', aRandomId, ['id']),
  ...notPersonal('holds', structure, [
    'session_id',
    'gift_id',
    'seats',
    'superseded_by',
  ]),
  ...notPersonal('holds', aFixedList, ['purpose', 'status', 'released_reason']),
  ...notPersonal('holds', aTime, [
    'expires_at',
    'paying_until',
    'created_at',
    'updated_at',
  ]),
  ...notPersonal('hold_items', structure, [
    'hold_id',
    'price_option_id',
    'quantity',
    'unit_price_minor',
    'uses_space',
  ]),
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
    'search_vector',
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
  ...notPersonal('orders', aRandomId, ['id']),
  ...notPersonal('orders', 'RMB- and six random characters; it names no one', [
    'reference',
  ]),
  ...notPersonal('orders', aFixedList, [
    'kind',
    'status',
    'tax_treatment',
    'cancelled_by',
    'currency',
  ]),
  ...notPersonal('orders', structure, [
    'idempotency_key',
    'hold_id',
    'session_id',
    'experience_id',
    'host_id',
    'gift_id',
    'waiver_document_id',
    'terms_document_id',
    'cancellation_tier_id',
    'age_confirmed',
    'refund_failed',
    'synthetic',
    'manage_token_version',
    'tax_rate_ppm',
    'commission_rate_bps',
  ]),
  ...notPersonal('orders', 'An amount of money in minor units', [
    'ticket_subtotal_minor',
    'tax_minor',
    'total_minor',
    'gift_applied_minor',
    'amount_due_minor',
    'commission_minor',
    'refunded_ticket_minor',
    'refunded_tax_minor',
    'commission_returned_minor',
  ]),
  ...notPersonal(
    'orders',
    'A short name of a marketing source, campaign, or issue; it names no one',
    ['attribution_source', 'attribution_campaign', 'attribution_issue'],
  ),
  ...notPersonal(
    'orders',
    'A one-way hash of a capability token, which is a credential and says nothing about a person',
    ['manage_token_hash'],
  ),
  ...notPersonal('orders', aTime, [
    'free_cancel_until',
    'created_at',
    'confirmed_at',
    'cancelled_at',
  ]),
  ...notPersonal('order_items', structure, [
    'order_id',
    'price_option_id',
    'quantity',
    'unit_price_minor',
    'uses_space',
    'line_total_minor',
  ]),
  ...notPersonal('order_items', publishedCopy, ['label']),
  ...notPersonal('gifts', aRandomId, ['id']),
  ...notPersonal('gifts', aFixedList, ['status']),
  ...notPersonal('gifts', structure, [
    'purchase_order_id',
    'experience_id',
    'redeemed_order_id',
    'token_version',
  ]),
  ...notPersonal('gifts', 'An amount of money in minor units', ['value_minor']),
  ...notPersonal(
    'gifts',
    'A one-way hash of a capability token, which is a credential and says nothing about a person',
    ['token_hash'],
  ),
  ...notPersonal('gifts', aTime, [
    'send_at',
    'sent_at',
    'valid_until',
    'created_at',
    'redeemed_at',
  ]),
  ...notPersonal('gift_items', structure, [
    'gift_id',
    'price_option_id',
    'quantity',
    'unit_price_minor',
    'tax_rate_ppm',
    'uses_space',
    'line_total_minor',
  ]),
  ...notPersonal('gift_items', publishedCopy, ['label']),
  ...notPersonal('payment_attempts', aRandomId, ['id']),
  ...notPersonal('payment_attempts', structure, [
    'order_id',
    'attempt_no',
    'amount_minor',
    'failed_tries',
  ]),
  ...notPersonal('payment_attempts', aFixedList, [
    'provider',
    'currency',
    'method',
    'status',
  ]),
  ...notPersonal(
    'payment_attempts',
    "The provider's own id or a key built from Ramble's ids",
    ['provider_key', 'provider_payment_id'],
  ),
  ...notPersonal(
    'payment_attempts',
    'A short code from a fixed vocabulary, such as card_declined',
    ['failure_code'],
  ),
  ...notPersonal('payment_attempts', aTime, ['created_at', 'updated_at']),
  ...notPersonal('provider_events', aRandomId, ['id']),
  ...notPersonal('provider_events', aFixedList, ['provider', 'type']),
  ...notPersonal(
    'provider_events',
    "The provider's own id of an event or object",
    ['provider_event_id', 'object_id'],
  ),
  ...notPersonal('provider_events', structure, [
    'ramble_order_id',
    'ramble_record_id',
    'amount_minor',
    'currency',
    'attempts',
  ]),
  ...notPersonal(
    'provider_events',
    "Ramble's own error text from handling an event, cut to 500 characters; it never repeats the body",
    ['last_error'],
  ),
  ...notPersonal('provider_events', aTime, [
    'occurred_at',
    'received_at',
    'processed_at',
  ]),
  ...notPersonal('fake_gateway_state', aFixedList, ['key']),
  ...notPersonal(
    'fake_gateway_state',
    "The fake payment gateway's own objects and events: Ramble ids, amounts, and fake client secrets, with no name, email, or card detail",
    ['state'],
  ),
  ...notPersonal('fake_gateway_state', aTime, ['updated_at']),
  ...notPersonal('refunds', aRandomId, ['id']),
  ...notPersonal('refunds', structure, [
    'order_id',
    'payment_attempt_id',
    'ticket_minor',
    'tax_minor',
    'commission_returned_minor',
    'amount_minor',
  ]),
  ...notPersonal('refunds', aFixedList, ['reason', 'status']),
  ...notPersonal(
    'refunds',
    "The provider's own id or a key built from Ramble's ids",
    ['provider_key', 'provider_refund_id'],
  ),
  ...notPersonal('refunds', aTime, ['created_at', 'succeeded_at']),
  ...notPersonal('transfers', aRandomId, ['id']),
  ...notPersonal('transfers', structure, [
    'order_id',
    'host_id',
    'amount_minor',
    'reversed_minor',
  ]),
  ...notPersonal('transfers', aFixedList, ['status']),
  ...notPersonal(
    'transfers',
    "The provider's own id or a key built from Ramble's ids",
    ['provider_key', 'provider_transfer_id'],
  ),
  ...notPersonal('transfers', aTime, ['release_after']),
  ...notPersonal('ledger_entries', 'A number', ['id']),
  ...notPersonal('ledger_entries', aTime, ['occurred_at', 'recorded_at']),
  ...notPersonal('ledger_entries', aFixedList, [
    'entry_type',
    'debit_account',
    'credit_account',
    'currency',
  ]),
  ...notPersonal('ledger_entries', structure, [
    'amount_minor',
    'order_id',
    'gift_id',
    'host_id',
    'payment_attempt_id',
    'refund_id',
    'transfer_id',
    'dispute_id',
    'simulated',
  ]),
  ...notPersonal(
    'ledger_entries',
    "The provider's own id for a payment, refund, transfer, or dispute",
    ['provider_object_id'],
  ),
  ...notPersonal(
    'ledger_entries',
    'A staff note about the money. The table cannot be edited, so a note never holds a guest name or contact',
    ['memo'],
  ),
  ...notPersonal('audit_log', 'A number', ['id']),
  ...notPersonal('audit_log', aTime, ['recorded_at']),
  ...notPersonal('audit_log', aFixedList, [
    'actor_kind',
    'action',
    'subject_kind',
  ]),
  ...notPersonal('audit_log', structure, ['subject_id']),
  ...notPersonal(
    'audit_log',
    'Ids, codes, and whole numbers only. The write schema and a CHECK refuse a string with a space or an @, so a name, an address, or a sentence cannot enter a row that is never corrected',
    ['details'],
  ),
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
    purpose:
      'Hourly database dump for recovery (PRD-75). The nightly audit-log export (PRD-74) is meant to live here too, but it is not switched on yet',
    data: 'A full copy of the database, including every column in the inventory. Once the audit export is switched on, it will hold the acting user id of each audit row',
    location: 'A region other than US East (ADR 0002)',
    deletionPath:
      'Dumps are deleted when they age out; a deletion request cannot reach into an existing dump, so a restore must re-run every anonymization made since the dump. The nightly audit-log export is not switched on yet, so no audit export is stored here today; the audit log itself stays in the database',
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
    dataset: 'support_requests',
    startsAt: "The row's creation",
    period: pendingCounsel,
    note: 'A contact message is kept until the support queue resolves it; the queue work adds the removal once the period is set',
  },
  {
    dataset: 'audit_log',
    startsAt: "The row's recorded time",
    period: pendingCounsel,
    note: 'The table allows no delete, so rows stay in the database. The nightly export is not switched on yet; once it is, the period is the lock on its objects, which only the storage lock can end',
  },
  {
    dataset: 'payment_tax_and_dispute_records',
    startsAt: 'The end of the tax year of the payment',
    period: pendingCounsel,
    note: 'PRD-73: kept to the minimum, access-limited, and never removed by a deletion request',
  },
];
