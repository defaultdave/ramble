# ADR 0002: Data, availability, and holds

- **Status:** Accepted 2026-10-18 (Dave), as recommended.
- **Date:** 2026-10-18
- **Question:** R2 in `docs/plan/BUILD-PLAN.md`, with the Q-11 booking-system spike
- **Research:** [research/r2-data-and-holds.md](research/r2-data-and-holds.md), [research/q11-booking-system-spike.md](research/q11-booking-system-spike.md)
- **Depends on:** ADR 0001, ADR 0003 (the payment-in-flight path), ADR 0007 (hosting region and scheduled jobs)

## Context

Ramble needs one place for the catalog, sessions and allocations, timed holds, orders, gifts, and every money movement. The hard parts are correctness under concurrent checkouts (never sell a space twice), a hold that can lapse while a guest is paying, and money records that reconcile to the payment provider. The app runs on serverless functions (ADR 0007), so anything held in memory is not shared between requests.

## Driving requirements

| ID | Why it matters here |
|---|---|
| PRD-16, PRD-17, PRD-21 | Never oversell; timed holds; hold limits; sold-out before paying |
| PRD-20, PRD-22 | Payment failure keeps the hold; never charged twice |
| PRD-33 | Gifts wait up to 12 months for redemption |
| PRD-41, PRD-42, PRD-43 | Host sessions, allocations, and a later live connection |
| PRD-47, PRD-56, PRD-57, PRD-59, PRD-78 | Payout statements, the finance export, money held, investor metrics, tax treatment |
| PRD-73, PRD-74, PRD-75 | Privacy and deletion; audit log; restore in 24 hours losing at most 1 hour |

## Options

**Storage**

| | A. Neon Postgres + Drizzle | B. Supabase Postgres + Drizzle | C. Turso (hosted SQLite) + Drizzle | D. In-memory | E. Postgres + Redis for holds |
|---|---|---|---|---|---|
| No oversell | Strong (row lock plus a database CHECK) | Strong | OK (one global writer) | Fails across instances | OK, but two stores can drift |
| Restore and 1-hour loss limit | OK on a paid plan; region loss needs an outside copy | Needs the paid point-in-time add-on | OK; region loss unknown | Fails | OK for the Postgres half |
| Money, audit, reporting | Strong | Strong | OK (weaker types) | Fails | Strong |
| Demo free tier | Does not pause; cold start only | Pauses after a week idle | Good | n/a | OK |
| Real-job cost | About $40 a month (estimate) | About $125 or more a month with point-in-time restore | About $5 a month | $0 | A plus a few dollars |

Notes: Supabase announced on 2026-10-02 that it is acquiring Turso, with no roadmap stated. Supabase becomes the better pick only if one vendor should also supply login and file storage (see R12 below).

**Hold mechanism:** lock the session row and derive availability from hold rows (H1); a conditional counter (H2); one row per seat (H3); Redis keys with expiry (H4); serializable transactions with retry (H5). **Expiry:** lazy on read (E1), a scheduled sweep (E2), a database cron (E3). **Access layer:** Drizzle or Prisma.

## Recommendation

**A: Neon Postgres (through the Vercel Marketplace) with Drizzle, behind a server-only data access layer. Holds use H1 with lazy expiry, and a database CHECK on confirmed seats is the hard backstop.**

1. **Two layers of "never oversell."** A timed hold under the session-row lock; then `seats_sold` is updated only when an order is confirmed, with `CHECK (seats_sold <= allocation)`. If application logic is wrong, the database still refuses. The same check stops capacity being set below what is booked (PRD-41).
2. **Holds** are rows (`active`, `paying`, `converted`, `released`) with `expires_at`. Spaces left are `allocation - seats_sold - active unexpired holds`. Reserving returns held (with the expiry for the countdown), sold out (with other dates), or blocked. The decision is a plain function in `lib/` (ARCH-1).
3. **Hold limits (PRD-17)** are derived from hold rows per device, with a transaction-level advisory lock so two tabs can't race past the limit.
4. **Payment in flight.** When the guest pays, the hold moves to `paying` with a short grace period. On the provider's success event the order confirms in one transaction. If the hold lapsed and the spaces are gone, the payment is refunded automatically and the guest is told (PRD-21). This path is designed up front, not discovered in testing.
5. **No double charge (PRD-22):** a unique idempotency key on orders before any provider call, a provider idempotency key derived from the order, and a table of provider events with unique IDs (webhooks can repeat or arrive out of order).
6. **Money:** integer minor units; an append-only ledger with one row per money event (charge, fee, refund, commission returned, transfer to host, gift liability in and out), each with the provider's ID. Orders snapshot price, commission, tax treatment, and tax at purchase. Statements, the finance export, and money held are views over the ledger.
7. **Gifts (PRD-33)** are vouchers, not holds: the payment is captured at purchase (a card authorization lasts about 7 days), and redemption is an ordinary hold and order.
8. **Sessions and allocations (PRD-42)** are generated from a recurrence template in the host's time zone (so "Saturday 10 am" survives daylight saving), safe to rerun. Each session has a `source` (`ramble`, `allocation`, `external`).
9. **Booking systems (Q-11 spike).** Verdicts from public documentation: FareHarbor, Peek Pro, and Mindbody need a partner program; Acuity is open (host on its Premium plan); Square can't book seat-based sessions; Eventbrite is read-only. So every external-system host launches on an allocation (PRD-42 as written), and PRD-43 stays a post-launch Should. The data access layer's availability port is shaped like the OCTO standard (check, reserve with expiry, confirm, cancel), but no external IDs or sync tables are built until a connector is chosen. Ops records each host's booking system as a label, and onboarding includes capping the allocated seats in the host's own system.
10. **Audit (PRD-74):** an insert-only audit table, written in the same transaction as each refund, cancellation, or payout change.
11. **People (PRD-73):** guests keyed by email; a deletion request anonymizes the guest and keeps payment, tax, and dispute records.
12. **Recovery (PRD-75):** the provider's history window for bad deploys and deletes, plus an independent hourly `pg_dump` to storage in another region for region loss. Rehearse one restore before launch.
13. **Proof:** a real-database concurrency test (fire more parallel reserves than there are spaces; exactly the right number succeed), also covering lapsed holds and payment in flight, run against a Neon branch in CI (ADR 0006). An in-memory fake implements the same interface for unit tests only.

**Demo:** Neon's free tier (no pausing; watch the monthly compute hours). Payouts write ledger rows marked simulated. Gift expiry runs as a real job, with twelve months simulated by backdated seed rows. No booking-system calls; allocation rows stand in.

## Login, roles, and photo storage (R12, folded in 2026-10-18)

Dave folded R12 into this ADR rather than opening a new one. PM note, not separately researched; the named products are examples to confirm at the walking skeleton.

- **Driving requirements:** PRD-37 (optional guest sign-in link, a Should), PRD-39 and PRD-45 (host access to their sessions and guest lists), PRD-48 (host staff access, a Should), PRD-50 to PRD-53 (ops and admin tools), PRD-52 (photo rights), PRD-73 (hosts see only their own guests), PRD-74 (roles and audit).
- **Sign-in:** email sign-in links, no passwords, through a library that keeps users and sessions in this same Postgres database with a Drizzle adapter (for example Better Auth or Auth.js). Guests book without accounts (PRD-15).
- **Roles:** guest, host owner, Ramble ops, Ramble admin, and host staff when PRD-48 ships. Every Server Action and data-layer function checks the caller's role and ownership against the row it touches (SEC-1, SEC-3), not only the page or proxy.
- **Photos:** object storage behind a wrapper module (for example Vercel Blob or an S3-compatible bucket), served through `next/image`. The rights record (PRD-52) and the seed manifest (ADR 0008) live in Postgres beside each photo.
- **What would change it:** a need for social sign-in, multi-factor authentication for ops, or enterprise single sign-on: a hosted identity provider behind a wrapper.

## Gift validity (decided 2026-10-18)

PRD-33 stays as signed (12 months, refund to the buyer if unredeemed), but the validity period and the expiry action are configuration, not code. New York's gift certificate law (GBL 396-i, as published: a nine-year minimum expiry) may apply to a gift of one specific experience; that is a counsel question (Q-16). If counsel says it applies, the configuration changes and gift money moves off the Stripe balance (ADR 0003).

## Amendment 2026-10-18: jobs, email, security, and data rules

Accepted by Dave with the [industry-gap review](research/industry-gap-review.md) (decision D4). Detail and sources are in the review and its [area notes](research/industry/).

**New tables, added once.** `jobs`, `messages` (with suppression), `provider_events` (already listed), `rate_limits`, `settings` (ops switches and gift validity), `synthetic_runs`, `support_requests`, `privacy_requests`, `consents`, `legal_documents` and acceptances, `report_snapshots`, `slug_history`, `photos` (metadata, rights, required alt text or a decorative flag), `host_documents` (private storage), `incidents`. A PII inventory lists every table and vendor holding personal data, so a deletion request (PRD-73) reaches all of them.

**Background jobs and email**
- An outbox: `jobs` rows are written in the same transaction as the state change and drained with `FOR UPDATE SKIP LOCKED`, with backoff and dead letters. A scheduled tick calls one secured, idempotent drain route; cron is a best-effort tick, not the queue (scheduling in ADR 0007).
- Inbound webhooks: verify the signature on the raw body, store with a unique event ID, return 2xx, process through `jobs`.
- Email sits behind `lib/email` with `resend` (real job), `postmark` (spare), and `fake` adapters. `EMAIL_MODE` (sink, allowlist, live) is enforced in the wrapper and is live only in production. Templates are React Email in the repo. The demo has no domain (decision D3), so every email goes to an in-app dev mailbox.
- `.ics` attachments and add-to-calendar links with a stable UID; Reply-To a monitored support address; gift emails only after payment, capped per sender and recipient, plain text with no links.

**Security data rules**
- App-level rate limits in `rate_limits` behind a wrapper: sign-in links per email, reserve, payment attempts (at most 5 per hold), manage-booking, forms. Payment is created only against an active hold.
- Staff sign-in: passkeys required for ops and admin through Better Auth, email links off for those roles, 8-hour sessions with a 30-minute idle timeout [proposed], and step-up for refunds, cancellations, payout and role changes. This replaces this ADR's earlier trigger for moving to a hosted identity provider.
- Sign-in and capability links: random tokens hashed at rest, single-use sign-in links with a 5-minute expiry, uniform replies.
- Audit log (PRD-74): a SQL-created role with insert and select only, a trigger that blocks updates and deletes, a nightly export to locked storage (Cloudflare R2 free tier in the demo). A hash chain is optional; if used, check it doesn't become a lock hotspot during a mass weather cancellation.
- An authorization matrix (role by action by resource) runs in CI against the real database (ADR 0006).

**Data operations**
- Connections: the pooled host for app traffic; the direct host for migrations and dumps; the HTTP driver for single reads; a pooled transaction for holds.
- The hourly `pg_dump` runs from a scheduled GitHub Actions workflow (free once the repo is public, decision D1) to Cloudflare R2, with a monthly restore test.
- Events quality: the `events` table filters bots and internal traffic, dedupes, and flags synthetic runs, so funnel numbers (PRD-61) aren't inflated by crawlers, tests, and staff.
- Reporting: a PII-free reporting schema and a read-only role; synthetic data excluded; month snapshots tied out to the ledger.
- Children's data stays limited to age and guardian contact and never enters analytics events. New York's Child Data Protection Act may apply to records with actual knowledge of a minor (counsel, Q-16).
- Real job: Neon Launch with an always-on compute floor; a read replica only if reads crowd checkout.

## What would change the call

- R12 picks Supabase for login and storage: switch to B with the point-in-time add-on; the hold design doesn't change.
- Gift cards are required (Q-13, PRD-34) or Q-01 moves to Ramble as seller: same store, deeper ledger (stored value, tax remittance, a balancing check).
- A booking system grants access with its own holds (Peek is the only one documented): that host's sessions use `source = 'external'` behind the same port.
- The concurrency test shows Neon's HTTP batch path misbehaves under the lock: use its WebSocket pool for the reserve path, or H5.
- Q-20 shows a much larger spike: cache catalog and spaces-left reads harder (ADR 0001).
