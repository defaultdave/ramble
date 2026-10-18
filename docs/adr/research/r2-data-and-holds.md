# R2: Data and backend for catalog, holds, orders, and money

Researched 2026-10-18 for ADR R2.

## Question

What stores Ramble's catalog, session availability, timed slot holds, orders, and money records, and what guarantees that a space is never sold twice, when the app runs as Vercel serverless functions? Recommend for the real job. Say what the demo simulates.

Sub-questions:

1. **Storage.** Hosted Postgres (Neon, Supabase), hosted SQLite (Turso), an in-memory store, or Postgres plus a separate store for holds.
2. **Hold mechanism.** Row locks, conditional updates, unique constraints, or a TTL store, under concurrent checkouts.
3. **Expiry.** Lazy expiry on read, or a scheduled job.
4. **Records.** The shape of money records, the audit log, and backup, enough to check the storage choice against PRD-47, 56, 74, 75, and 78.
5. **Access layer.** Drizzle or Prisma, measured against the house standards.

## Driving requirements

| ID | Why it matters here |
|---|---|
| PRD-14, PRD-15 | One dated session, one party size, guest checkout. A booking has no account to hang state on, so the hold and the order carry a signed device cookie and a verified email. |
| PRD-16 | Never oversell. The hold is a timed claim on spaces that the guest can see. This is the main driver of the storage and locking choice. |
| PRD-17 | At most 6 spaces held per guest or device, and 3 unpaid holds in 15 minutes trigger a 15-minute block. The data store has to answer "how many active and lapsed holds does this device have" cheaply and exactly. |
| PRD-20 | A failed payment keeps the hold while it lasts. Payment retries and the hold clock interact. |
| PRD-21 | If spaces sold out before the hold, or the hold lapsed and the spaces went, say so before payment. The reserve step must return a typed result (held, sold out, blocked), not throw. |
| PRD-22 | Never charge twice. Needs unique keys at three layers: the order, the provider call, the provider event. |
| PRD-33 | Gifts sit for up to 12 months and are refunded at expiry if unredeemed. This is durable money state, a daily job, and a refund path that may meet an expired card. |
| PRD-41 | Capacity cannot drop below what is booked. A schema CHECK can enforce this. |
| PRD-42 | Allocations: a seat count per recurring session, with Ramble generating the dates. Needs idempotent date generation and correct time zones. |
| PRD-47, PRD-56, PRD-57 | Payout statements, a per-booking finance export that reconciles to the provider's payouts, and a view of money held. These want append-only money rows with provider IDs, and SQL that can aggregate them. |
| PRD-59 | Monthly GMV, take rate, and repeat rate. Aggregation over bookings and refunds, with dates. |
| PRD-70, PRD-71 | A newsletter spike (sized to 12,500 visitors in 3 hours) and 99.9% availability of the booking path. Scale is modest for the data tier. The risk is cold starts and connection handling, not throughput. |
| PRD-72, PRD-73 | No card data stored. Guest details split from financial rows so deletion requests can be honored while records Ramble must keep stay. |
| PRD-74 | Refunds, cancellations, and payout changes are logged with who and when. |
| PRD-75 | Restore within 24 hours, losing at most 1 hour of records, including if the data store or hosting region is lost. |
| PRD-78 | Each experience has a tax treatment. The order must snapshot the treatment, rate, and amount. |
| C-09 | Demo: test-mode payments, seeded hosts, simulated payouts. |

House rules that bound the answer: a server-only data access layer that returns minimal objects (SEC-4, RSC-5), schema validation at the boundary with Zod as the default (DATA-4), `import 'server-only'` on modules that hold a database client, idempotency keys on retryable writes (FORM-8), and Server Actions that re-derive price and role on the server (SEC-1, SEC-3). These come from `~/.claude/standards/react-nextjs.md` (sections 1, 4, 5, 12) and `architecture.md` rule A2 (local files).

## Options

### Storage

#### A. Neon Postgres (through the Vercel Marketplace) with Drizzle

**How it works.** Neon is serverless Postgres, provisioned from Vercel with `vercel install neon`, which injects credentials as environment variables ([Vercel storage](https://vercel.com/docs/storage)). The app has two ways to connect. The HTTP driver runs single queries and non-interactive batches. The WebSocket `Pool` or `Client` supports interactive transactions, which Neon says to reach for only when interactive transactions are needed ([Neon serverless driver](https://neon.com/docs/serverless/serverless-driver)). Pooled connections go through PgBouncer in transaction mode (up to 10,000 client connections), where session-level advisory locks and session `SET` are not supported ([Neon connection pooling](https://neon.com/docs/connect/connection-pooling)). Row locks (`FOR UPDATE`) and transaction-level work are unaffected, because they live inside one transaction. The Vercel integration can create a database branch per preview deployment ([Neon and Vercel](https://neon.com/docs/guides/vercel-managed-integration)), which suits e2e tests against a real database (R6).

**Fit to the PRD.**
- Serves PRD-16, 17, 21, 22 with row locks, unique indexes, and transactions (see hold mechanisms).
- Serves PRD-47, 56, 57, 59 with SQL aggregation, window functions, and numeric types.
- Serves PRD-74 with an append-only audit table: `REVOKE UPDATE, DELETE` from the application role ([PostgreSQL REVOKE](https://www.postgresql.org/docs/current/sql-revoke.html)). Neon's extension list does not include `pgaudit` ([Neon extensions](https://neon.com/docs/extensions/pg-extensions)), so the audit log is an application table.
- Serves PRD-75: history window is 6 hours on Free, up to 7 days on Launch, up to 30 days on Scale ([Neon plans](https://neon.com/docs/introduction/plans)). That covers a bad deploy or a bad delete. Each Neon project lives in exactly one region ([Neon regions](https://neon.com/docs/introduction/regions)), and I found no cross-region replication in the pages I read. "Hosting region lost" therefore needs an independent copy (see Risks).
- Strains PRD-70 only through cold starts: compute suspends after 5 minutes idle, fixed on Free, and wakes in roughly a few hundred milliseconds ([Neon scale to zero](https://neon.com/docs/introduction/scale-to-zero)). A warm-up request before a newsletter send removes this (my suggestion).
- Strains PRD-47's weekly payout job if it relies on `pg_cron`: Neon says `pg_cron` runs only while compute is active, so it needs scale to zero disabled ([Neon extensions](https://neon.com/docs/extensions/pg-extensions)). Use Vercel Cron instead.

**Cost.**
- Demo (Free): 100 CU-hours per project per month, 1 GB per project, 10 branches, 6-hour history, autoscaling to 2 CU, 5 GB egress; running out of CU-hours suspends compute until the next period ([Neon plans](https://neon.com/docs/introduction/plans), [Neon pricing](https://neon.com/pricing)). Seed data for 40 to 60 experiences is far below 1 GB.
- Real job (Launch): $0.106 per CU-hour, $0.35 per GB-month, $0.20 per GB-month for instant restore, no monthly minimum listed ([Neon pricing](https://neon.com/pricing)). My estimate at 0.5 CU average and 5 GB: about $40 a month. That is arithmetic on list rates with assumed usage, not a quote.

**Risks.**
- Vendor change. One Neon page calls its preview branches Lakebase Postgres branches ([Neon and Vercel](https://neon.com/docs/guides/vercel-managed-integration)). I did not research what that rename means. Standard Postgres is the fallback: any `pg_dump` loads elsewhere.
- Free-plan commercial use is not addressed on the pricing and plans pages I read. Irrelevant for a demo. Use a paid plan for the real job.
- Interactive transactions need the WebSocket driver, which holds a connection per request. Close it in the same request (Vercel's own guidance is to use pooling and clean up connections: [Vercel limits](https://vercel.com/docs/functions/limitations)).

**Evidence.** Neon docs and pricing (undated pages; read 2026-10-18). Postgres 18.6 documentation for locking and isolation behavior.

#### B. Supabase Postgres (Pro for the real job) with Drizzle

**How it works.** Same Postgres semantics as A. Serverless functions should use the shared pooler in transaction mode (port 6543), which does not support prepared statements and loses session-level state such as session advisory locks. Direct connections are IPv6 unless the IPv4 add-on is bought ([Supabase connecting](https://supabase.com/docs/guides/database/connecting-to-postgres)). Supabase also bundles auth and storage.

**Fit to the PRD.**
- Same as A for PRD-16, 17, 21, 22, 47, 56, 59, 74.
- PRD-75 is the difference. Pro keeps 7 days of daily backups. PITR is an add-on, with a two-minute WAL interval and a worst-case two-minute RPO, and it requires at least a Small compute add-on ([Supabase backups](https://supabase.com/docs/guides/platform/backups)). **Daily backups alone give a 24-hour RPO, which fails PRD-75's 1 hour.** The real job would need the PITR add-on.
- Could absorb PRD-37 (magic-link accounts), PRD-74 roles, and image storage for PRD-50/52, which no ADR in R1 to R10 covers. That bundling is the main reason to pick B.

**Cost.**
- Demo (Free): 500 MB database, 2 active projects, 5 GB egress, **Free projects are paused after 1 week of inactivity**, and automatic backups are not included ([Supabase pricing](https://supabase.com/pricing)). A demo that sits idle for a week is a demo that is down until someone resumes it. The backup doc says only that daily backups cover Pro, Team, and Enterprise, and suggests free projects export regularly ([Supabase backups](https://supabase.com/docs/guides/platform/backups)).
- Real job: Pro from $25 a month, plus PITR at $100 a month per 7 days of retention ([Supabase pricing](https://supabase.com/pricing)), plus the Small compute add-on (price not read). At least about $125 a month before compute.

**Risks.** Pausing on Free; a restore makes the project inaccessible while it runs ([Supabase backups](https://supabase.com/docs/guides/platform/backups)); transaction-mode pooler quirks (use only transaction-level advisory locks).

**Evidence.** Supabase pricing and docs (undated; read 2026-10-18).

#### C. Turso (hosted SQLite) with Drizzle

**How it works.** SQLite allows many simultaneous readers but only one write transaction at a time; a second writer fails with `SQLITE_BUSY` ([SQLite transactions](https://www.sqlite.org/lang_transaction.html)). The libSQL client offers `write` transactions (`BEGIN IMMEDIATE`) that cannot run in parallel, and a 5-second lock timeout on interactive transactions ([Turso TypeScript reference](https://docs.turso.tech/sdk/ts/reference)). There is no row lock. A hold is one write transaction, or one atomic batch.

**Fit to the PRD.**
- PRD-16 is achievable: a conditional `INSERT ... SELECT` runs as a single statement under the database-wide write lock, so there is no interleaving. Correctness is easy. Throughput is the whole database's write rate, not per session. At Ramble's volume (1,800 bookings a month by month 6, per the PRD) that is not a constraint. Interactive transactions over a network hold the global write lock across round trips, so use batches.
- PRD-47, 56, 59: SQLite has window functions and aggregation, but weaker types (no native date, numeric, or enum types) put more rules in the application. Money as integer cents is fine.
- PRD-75: Free PITR is 24 hours, Developer 10 days, Scaler 30, Pro 90. A restore creates a new database, so the app needs a new connection string and token ([Turso PITR](https://docs.turso.tech/features/point-in-time-recovery)).
- Local dev uses the same engine as production (a file database), which removes a class of "works locally" gaps.

**Cost.** Free: 100 databases, 5 GB, 500 million rows read and 10 million rows written per month, 24-hour PITR; the page states no inactivity pause, which I could not confirm elsewhere. Developer $4.99 a month with 10-day PITR (billing term unclear) ([Turso pricing](https://turso.tech/pricing)).

**Risks.**
- **Ownership change.** Turso and Supabase announced on 2026-10-02 that Supabase is acquiring Turso. Turso's post says the service keeps running, and Supabase's says nothing changes for existing users. Neither post states whether the deal has closed or gives a roadmap ([Turso post](https://turso.tech/blog/turso-is-joining-supabase), [Supabase post](https://supabase.com/blog/supabase-is-acquiring-turso)). The Turso post also describes a path from SQLite to Postgres through Supabase for workloads that outgrow it.
- The money records and reporting PRD-47/56/57/59 want live in Postgres-shaped tooling. Moving later means migrating the most sensitive data.
- One global writer, 5-second interactive lock timeout, and no `FOR UPDATE`.

**Evidence.** SQLite and Turso docs; two primary posts dated 2026-10-02. Secondary coverage exists but is not relied on.

#### D. In-memory store

**How it works.** Module-level `Map`s seeded at boot.

**Fit to the PRD.** Fails PRD-16, 22, 33, 47, 74, 75. With Fluid compute, multiple invocations can share one instance and its process state ([Vercel Fluid compute](https://vercel.com/docs/fluid-compute)), but functions scale out to many instances (concurrency up to 30,000 on Hobby and Pro, per [Vercel limits](https://vercel.com/docs/functions/limitations)), and Vercel gives no cross-instance sharing or persistence guarantee that I could find. Two requests for the same session can land on different instances, each with its own count. State vanishes on redeploy or instance recycle (my inference).

**Cost.** Free. **Risks.** Silent oversell with no error. **Use it for:** a fake adapter behind the DAL interface in unit tests (ARCH-1, TEST-2). It cannot test locking, so it never replaces the real-database concurrency test.

**Evidence.** Vercel docs (last updated 2026-08-24).

#### E. Postgres plus Redis (Upstash) for holds

**How it works.** Holds live in Redis with TTL. A Lua script checks and claims atomically. Confirmed bookings live in Postgres.

**Fit to the PRD.**
- Upstash's REST API supports scripting and `MULTI/EXEC` but not `WATCH` ([Upstash REST](https://upstash.com/docs/redis/features/restapi)). That is enough for an atomic claim.
- A TTL does not fix counters. When a key expires it is deleted; commands like `INCR` leave the timeout alone ([Redis EXPIRE](https://redis.io/docs/latest/commands/expire/)). A lapsed hold only frees seats if each hold is its own key (or a sorted-set member filtered by score), and the count is derived. Expiry is passive on access plus a periodic random sweep, so deletion is not instant.
- PRD-16 needs "sold" and "held" in one atomic decision. If sold lives in Postgres and held in Redis, the check spans two stores. Mirror the sold count into Redis and the mirror can drift. Skip the mirror and the claim is not atomic.
- Helps PRD-17 counters and rate limits, which the Vercel storage page lists as a Redis use ([Vercel storage](https://vercel.com/docs/storage)). Postgres can do this too, from hold rows.

**Cost.** Free: 500K commands a month, one database, 10,000 commands a second; pay as you go $0.20 per 100K commands ([Upstash pricing](https://upstash.com/pricing/redis), undated). Trivial money. The cost is a second thing to back up, monitor, and reconcile.

**Risks.** Two sources of truth for the most important invariant; I could not confirm Redis persistence guarantees on the Free plan from the pricing page.

**Evidence.** Upstash and Redis docs.

### Hold mechanisms (for A, B, C)

| ID | Mechanism | Why it does not oversell | Expiry | Strains | Serves |
|---|---|---|---|---|---|
| H1 | **Lock the session row, derive availability.** In one transaction: `SELECT ... FOR NO KEY UPDATE` on the session, then a second statement computes `allocation - seats_sold - sum(active holds)` and inserts the hold | Concurrent reservers for one session queue on the row lock, so each sees the previous one's hold. `FOR NO KEY UPDATE` blocks other lockers and updaters but not `FOR KEY SHARE` ([Postgres explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)) | Lazy: expired holds simply stop counting | Needs two statements, so the WebSocket driver or an HTTP batch. Sum on every read (small, indexed) | PRD-16, 17, 20, 21 |
| H2 | **Counter plus conditional update.** `UPDATE sessions SET held = held + n WHERE id = $1 AND allocation - sold - held >= n` | Under Read Committed, a waiting UPDATE re-evaluates its `WHERE` against the committed new row version ([Postgres isolation](https://www.postgresql.org/docs/current/transaction-iso.html)), so the check and the write are one atomic step. Works as a single HTTP statement | Needs a sweeper to decrement `held`, or a counter that drifts | Counter drift after crashes; the sweeper is a cron job that Hobby cannot run often | PRD-16, 70. Good for `seats_sold` (see Recommendation), poor for timed holds |
| H3 | **Per-seat claim rows**, `UNIQUE (session_id, seat_no)` | The unique index rejects a second claim. `ON CONFLICT` gives an atomic insert-or-skip outcome ([Postgres INSERT](https://www.postgresql.org/docs/current/sql-insert.html)) | Delete expired claims before inserting (lazy) | Needs seat numbers for general admission, n inserts per party, retries when seats collide | PRD-16, 42. Heavy for this domain |
| H4 | **Redis keys with TTL and Lua** (option E) | Lua script atomic in Redis | Key TTL | Two stores (above) | PRD-16, 17 |
| H5 | **SERIALIZABLE plus retry** | Postgres aborts one of two conflicting transactions | Lazy | A retry loop in the app. Prisma's docs say the application must write the retry itself ([Prisma transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)) | PRD-16 |

**A trap in H1.** Doing the lock and the sum in one statement (a CTE with `FOR UPDATE` plus a `sum` subquery) looks safe and probably is not. Under Read Committed a statement sees only rows committed as of its own start ([Postgres isolation](https://www.postgresql.org/docs/current/transaction-iso.html)). The locking read waits for the other transaction and then returns the updated session row, but the `sum` in the same statement still uses the earlier snapshot and cannot see the other transaction's new hold. The two-statement form gets a fresh snapshot for the second statement. This is my inference from the documented snapshot rule. It is the first thing the concurrency test must prove or disprove.

**Use database time.** `now()` is the start of the transaction, `statement_timestamp()` the start of the statement, and `clock_timestamp()` the actual time ([Postgres date/time functions](https://www.postgresql.org/docs/current/functions-datetime.html)). Compare `expires_at` against database time inside the locked section, not against each function instance's clock, so instances cannot disagree about whether a hold lapsed.

### Expiry

| ID | Approach | Verdict |
|---|---|---|
| E1 | **Lazy.** Every availability query ignores holds where `expires_at` has passed. The state change to `expired` is written when the hold is next touched, and by a daily cleanup | Works on any plan. No timer can be late, because nothing depends on a timer. Serves PRD-16, 17, 21. PRD-17's "3 unpaid holds in 15 minutes" is a count over hold rows, so it needs no counter |
| E2 | **Scheduled sweeper** (Vercel Cron) | On Hobby, cron runs at most once a day with per-hour precision (a job set for 1:00 am may run anywhere from 1:00 to 1:59), and cron jobs invoke ordinary Vercel Functions ([Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)). Pro allows once a minute. Strains PRD-16 and PRD-21 if it is the only release path, because a 10-minute hold would sit for up to a day on Hobby. Fine for hygiene on any plan |
| E3 | **Database timers** (`pg_cron`) | Neon: only runs while compute is awake ([Neon extensions](https://neon.com/docs/extensions/pg-extensions)), which conflicts with Free scale to zero and PRD-71 on a paid plan that scales to zero. Supabase: not checked. Not needed if E1 is used |
| E4 | **TTL key expiry** (Redis) | Frees a key, not a count (above). Serves PRD-17 counters, strains PRD-16 through the two-store problem |

**Jobs that need a clock whatever the hold design.**
- Gift expiry at 12 months and weekly payouts (PRD-33, PRD-47): a daily or weekly Hobby cron is enough.
- 24-hour reminders within an hour either side (PRD-27) and gift delivery within 5 minutes of the delivery time (PRD-33): Hobby cron cannot do either. This needs per-minute cron (Pro) or a queue. That is R7's call. The data side is a `jobs` table with `run_at` that a worker drains with `FOR UPDATE SKIP LOCKED`, which Postgres documents for queue-like tables ([Postgres SELECT](https://www.postgresql.org/docs/current/sql-select.html)).

### Access layer

| ID | Option | Evidence | Verdict |
|---|---|---|---|
| O1 | **Drizzle** | The select builder has `for(strength, config)` ([source, main branch](https://raw.githubusercontent.com/drizzle-team/drizzle-orm/main/drizzle-orm/src/pg-core/query-builders/select.ts)); I did not find it on the docs page for select ([Drizzle select](https://orm.drizzle.team/docs/select)). Transactions take `isolationLevel` ([Drizzle transactions](https://orm.drizzle.team/docs/transactions)). Neon HTTP and WebSocket drivers both supported; WebSocket for interactive transactions ([Drizzle on Neon](https://orm.drizzle.team/docs/connect-neon)). Zod schema generation from tables is documented on the RC line (`npm i drizzle-orm@rc zod`) ([Drizzle Zod](https://orm.drizzle.team/docs/zod)). `npm latest` is 0.45.4 ([npm](https://registry.npmjs.org/drizzle-orm/latest)) | Fits H1 and raw `sql` for H2. Close to SQL, so the lock and the conditional update are visible in code review. Pin a line at setup: 0.45.x stable or the 1.0 RC |
| O2 | **Prisma** | Stable client is 7.10.1; Prisma 8 is a release candidate with general availability expected in October 2026, and its RC lacks transaction isolation levels and atomic `increment` ([Prisma release status](https://www.prisma.io/docs/orm/release-status)). Prisma 8 transaction docs show no row-lock or version-check pattern ([Prisma transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)). Prisma 7 documents an `isolationLevel` option and says to retry on write-conflict errors (search summary of the ORM 7 reference; I did not read that page directly) | Workable through raw queries, but the headline feature (typed queries) does not cover the one query that matters. A major version lands this month. Prefer not to start on a moving target |

## Comparison

Ratings: **Strong**, **OK**, **Weak**, **Fails**.

| | A. Neon + Drizzle | B. Supabase + Drizzle | C. Turso + Drizzle | D. In-memory | E. Postgres + Redis |
|---|---|---|---|---|---|
| No oversell (PRD-16, 21) | Strong (H1, plus CHECK backstop) | Strong | OK (global write lock; correct, serialized) | **Fails** across instances | OK, with two-store drift risk |
| Hold limits and lapse counts (PRD-17) | Strong (derived from hold rows) | Strong | OK | Fails | Strong (counters), at the cost of a second store |
| No double charge (PRD-22) | Strong (unique keys, event table) | Strong | OK (unique keys work) | Fails | OK |
| Gifts 12 months, restore in 24 h, RPO 1 h (PRD-33, 75) | OK on Launch (7-day history); region loss needs an external copy | Weak on daily backups, OK with PITR add-on | OK (10-day PITR on Developer); region loss unknown | Fails | OK for Postgres half; Redis not a system of record |
| Money, audit, reporting (PRD-47, 56, 57, 59, 74) | Strong | Strong | OK (weaker types) | Fails | Strong |
| Demo free-tier fit | Strong (no pause; cold start only) | Weak (pauses after 1 week idle) | Strong | n/a | OK (500K commands a month) |
| Real-job cost | about $40 a month (estimate) | $125+ a month with PITR | about $5 a month | $0 | A plus a few dollars |
| Fits house standards (SEC-4, RSC-5, DATA-4) | Strong | Strong | Strong | OK as a test fake | OK |
| Moving parts | 1 data store | 1 data store | 1 data store | 0 | 2 data stores |

## Recommendation

**Use hosted Postgres on Neon through the Vercel Marketplace, accessed with Drizzle behind a server-only DAL. Make holds H1 (lock the session row, derive availability) with lazy expiry E1. Add a hard CHECK backstop on confirmed seats.** Treat Supabase as the alternative if the auth ADR chooses Supabase Auth.

Why: it is the only option that gives one transactional store for holds, orders, and money, with a schema that enforces the invariants, a demo-friendly free tier that does not pause, and a restore window that can meet PRD-75 on a paid plan. Lazy expiry is the only release mechanism that works on Hobby cron and is still correct on Pro.

**Data rules for the ADR to carry:**

1. **Two layers of "never oversell".** Layer one is the timed hold, H1, under the session-row lock. Layer two is `sessions.seats_sold`, updated only in the order-confirmation transaction, with `CHECK (seats_sold <= allocation)`. If application logic is wrong, the database still refuses to confirm a space that is not there. The same CHECK shape covers PRD-41: capacity cannot be set below `seats_sold`.
2. **Hold lifecycle.** Rows in `holds` with `session_id`, `qty`, `device_id`, `expires_at`, `state` (`active`, `paying`, `converted`, `released`). Available spaces = `allocation - seats_sold - sum(qty of active holds not past expires_at)`. Index on `(session_id)` where active. The reserve function returns a typed result: held (with `expires_at` for the countdown), sold out (with other dates), or blocked (with `blocked_until`). This is PRD-21's "before paying".
3. **Hold limits (PRD-17).** Derived from `holds` by `device_id`: sum of active qty at most 6, and 3 lapsed-without-payment holds in the last 15 minutes blocks until 15 minutes after the third lapsed hold expired (assumed reading). Take a transaction-level advisory lock on the device key so two tabs cannot race past the limit. Use the transaction-level form only: it releases automatically when the transaction ends ([Postgres explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)). Session-level locks are lost under both Neon's and Supabase's pooler modes ([Neon pooling](https://neon.com/docs/connect/connection-pooling), [Supabase connecting](https://supabase.com/docs/guides/database/connecting-to-postgres)).
4. **Payment in flight must not lose the hold.** When the guest submits payment, set the hold to `paying` and extend `expires_at` by a short fixed grace (3-D Secure and wallet sheets take time). On the provider's success event, confirm in one transaction. If the hold lapsed anyway, try to claim the spaces again under the lock. If they are gone, refund automatically and tell the guest (PRD-21). This is the case where a guest is charged and has no seat, and it must be designed, not discovered. It also needs R3's input (see Risks).
5. **No double charge (PRD-22), three layers.** (a) `orders.idempotency_key` UNIQUE, created with `INSERT ... ON CONFLICT` before any provider call. (b) The provider call uses an idempotency key derived from the order ID. Stripe keys are up to 255 characters, saved results are returned on retry, and v1 keys can be pruned after 24 hours ([Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)). (c) A `provider_events` table with `event_id` UNIQUE, because Stripe can send the same event more than once, does not guarantee order, and retries for up to three days in live mode ([Stripe webhooks](https://docs.stripe.com/webhooks)). Order status changes are conditional updates (`WHERE status = 'pending'`).
6. **Money rows.** Integer minor units. An append-only `ledger_entries` table: one row per money event (charge, processing fee, refund, commission returned, payout, gift liability in, gift liability out), each with the provider's ID, so PRD-56 reconciles to the provider's payouts. Orders snapshot price, commission rate (15% of ticket before tax, per Q-03), tax treatment, tax rate, and tax amount at purchase, so later price or rate changes apply only to new bookings (PRD-41, PRD-78). "Unknown" tax treatment writes a flag that the finance export shows. Statements (PRD-47) and the money-held view (PRD-57) are SQL views over the ledger, not stored totals.
7. **Gifts (PRD-33).** A `gifts` row is a voucher, not a hold. No seats are held until redemption, and redemption is an ordinary hold and order. Capture at purchase: a card authorization is valid about 7 days for online payments (Visa merchant-initiated 5 days) ([Stripe authorization windows](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)), so 12 months cannot be held as an authorization. The money sits in the platform's provider balance, tracked by the gift-liability ledger entries. A daily job refunds gifts past 12 months. Refunds can only go back to the original payment method. A refund to an expired card normally reaches a replacement card through the issuer and in rare cases fails ([Stripe refunds](https://docs.stripe.com/refunds)), so the failure path (`refund.failed`) is a work item.
8. **Sessions and allocations (PRD-42).** Materialize sessions from a recurrence template with `UNIQUE (experience_id, starts_at)` and `INSERT ... ON CONFLICT DO NOTHING`, so the generator is safe to rerun. Store `starts_at` as a UTC timestamp generated from local wall time in the host's time zone (America/New_York), not by adding 7 days, or "every Saturday at 10 am" drifts an hour across daylight saving changes (my design note). Add `source` (`ramble`, `allocation`, `external`) so a Q-11 booking-system connection (PRD-43) can plug in behind the same DAL port.
9. **Audit (PRD-74).** `audit_events` with actor, role, action, target, before and after, time. The application role has INSERT and SELECT only. Write the audit row in the same transaction as the refund, cancellation, or payout change.
10. **People data (PRD-15, 73).** `guests` keyed by normalized email, holding name and contact. Orders and ledger rows reference `guest_id`. A deletion request anonymizes the guest row and leaves payment, tax, and dispute records. Newsletter opt-in rows record the time and source.
11. **Backup (PRD-75).** On a paid plan, use the provider's history window for bad deploys and bad deletes. For "region lost", run an independent logical dump (`pg_dump` on a direct connection, which Neon recommends for `pg_dump` ([Neon pooling](https://neon.com/docs/connect/connection-pooling))) at least hourly to storage in another region or at another provider. The financial tables are small, so hourly is cheap. Rehearse the restore once before launch, and time it against the 24-hour limit.
12. **DAL shape (SEC-4, RSC-5, DATA-4, ARCH-1).** `import 'server-only'` in the DAL. Each function takes validated input (Zod from the table definitions where available) and returns a minimal object. The hold decision (given counts, allocation, and limits, return held, sold out, or blocked) is a plain function in `lib/`; the DAL runs the locked reads and the insert and calls it. An in-memory fake implements the same interface for unit tests.
13. **The test that proves it.** A real-database concurrency test: for a session with allocation `k`, fire `n > k` parallel reserve calls, and assert exactly `k` succeed (or the right total quantity), then repeat with lapsed holds and with the payment-in-flight path. Run it against a Neon branch in CI (R6). Do not run it against the in-memory fake.

**Free-tier limits to watch in the demo.** Neon: 100 CU-hours a month (compute stops when exhausted), 5-minute scale to zero with a cold start of a few hundred milliseconds, 6-hour history. Vercel Hobby: cron once a day, personal and non-commercial use only ([Vercel Hobby](https://vercel.com/docs/plans/hobby)), 300-second function maximum. Check CU-hours before a demo and send a warm-up request first.

**What the demo simulates.**
- Payments run in provider test mode (R3). No card data touches the app.
- Hosts, experiences, sessions, and allocations come from the R8 seed through an idempotent script. "Restore" for the demo is reseed plus a history-window restore exercise on a branch.
- Weekly payouts are a real job that writes `payout` ledger rows marked `simulated`. No Connect transfers move money.
- Gift expiry is a real daily job. Twelve months is simulated by backdated seed rows.
- Host booking-system connections (PRD-43) are not built. Rows with `source = 'allocation'` stand in.
- Reminder email timing (PRD-27) cannot run on Hobby cron. Trigger it from a protected route in the demo. The real job needs R7's answer.
- The 99.9% availability target (PRD-71) and the spike target (PRD-70) are not demonstrated by a free tier.

**What the real job adds.** Paid Neon (Launch or Scale), Vercel Pro for per-minute cron and commercial use, an external hourly dump, the provider's real payout flow, counsel's answer on who holds money (Q-01 and Q-16), and a rehearsed restore.

## What would change the call

- **The auth ADR picks Supabase Auth, or the team wants one vendor for database, auth, and storage.** Then B becomes the pick, with the PITR add-on, because Supabase absorbs PRD-37, PRD-74 roles, and photo storage. Nothing in the hold design changes.
- **Q-01 flips to Ramble as seller of record (a), or Q-13 requires gift cards (PRD-34).** The store stays Postgres. The ledger gets deeper: stored value that is not tied to a host, tax remittance, and a stronger case for a double-entry ledger with a balancing check.
- **The Q-11 spike finds booking systems that expose reservable inventory with their own hold timers.** For those hosts the external system becomes the source of truth. Ramble's hold becomes a coordinating record and `source = 'external'` rows call out through the DAL port. This changes H1 for those sessions only.
- **The concurrency test shows the two-statement lock form misbehaves on the Neon HTTP batch path.** Then require the WebSocket `Pool` for the reserve path, or switch to SERIALIZABLE with retry (H5).
- **Q-20 shows a much larger newsletter spike.** Add caching for catalog and "spaces left" reads (DATA-10), and revisit connection pooling. The row lock is per session and is not a bottleneck unless one class draws hundreds of simultaneous attempts.
- **A cheap, single-vendor SQLite stack matters more than reporting depth, and the Turso acquisition settles.** Then C is a defensible demo-only choice. I would still not carry it to the real job.
- **Neon's terms or pricing change, or its rename is more than a rename.** Fall back to B or any standard Postgres. The DAL and schema do not change.

## Open risks

1. **Refunding a gift at 12 months (PRD-33).** I could not find a card refund time limit in the Stripe pages I read. Several non-card methods carry a 180-day window (search result summaries for ACH and others: [Stripe ACH refunds](https://support.stripe.com/questions/refunds-for-ach-direct-debit-payments)), and the refunds page says refunds can only return to the original method. Confirm with Stripe that a card charge 12 months old can still be refunded, and design the failure path. Owner: R3.
2. **Hold lapse during payment (PRD-16, 20, 22).** If R3 picks Stripe-hosted Checkout, a session must be set to last between 30 minutes and 24 hours ([Stripe Checkout Session](https://docs.stripe.com/api/checkout/sessions/create)) against a 10-minute hold, so a guest can pay after the hold lapsed. Payment Element with a PaymentIntent avoids that. Either way, the late-success path in rule 4 is needed.
3. **Scheduled work on Hobby.** Daily cron with up to 59 minutes of imprecision cannot meet PRD-27, PRD-28's 5-minute emails if they depend on a poller, or PRD-33's delivery time. Event-driven sends after commit (an outbox) cover cancellations and bookings; reminders and gift delivery need a per-minute clock. Owner: R7.
4. **No ADR covers auth, roles, or image storage** (PRD-37, 48, 50, 52, 74). The R2 pick does not need them, but the Supabase comparison turns on them. Raise at the P2 gate.
5. **Region loss (PRD-75).** Neon pages I read describe one region per project and no cross-region replication. Not verified whether it exists elsewhere. Plan on the external dump.
6. **Tool versions are moving.** Drizzle `latest` is 0.45.4 while docs point at `@rc` for Zod generation; Prisma 8 reaches general availability around now. Pin versions at the walking skeleton and run the concurrency test on the pinned stack.
7. **The Read Committed snapshot trap and the HTTP batch path are inferences** (H1 note). Verify with the concurrency test before the ADR is final.
8. **Time zones and daylight saving** in allocation-generated sessions (rule 8) are a design note, not a researched fact. Cover with a test across both clock changes.
9. **Free-tier terms.** Neon pages do not address commercial use of Free. Vercel Hobby is personal and non-commercial. Both are fine for a portfolio demo. Neither is for the real job.
10. **Acquisition noise.** The Turso and Supabase deal is announced, and the posts do not say whether it has closed. It affects options B and C only.

## Sources

Read 2026-10-18. "Undated" means the page shows no date. Where a page shows one, it is given. Nothing I relied on is older than 12 months as far as the dates show; undated pages could be older.

| Topic | Source | Version or date |
|---|---|---|
| Neon plans and limits | [Plans](https://neon.com/docs/introduction/plans), [Pricing](https://neon.com/pricing) | Undated |
| Neon serverless driver | [Serverless driver](https://neon.com/docs/serverless/serverless-driver) | Undated |
| Neon scale to zero | [Scale to zero](https://neon.com/docs/introduction/scale-to-zero) | Undated |
| Neon pooling | [Connection pooling](https://neon.com/docs/connect/connection-pooling) | Undated |
| Neon regions | [Regions](https://neon.com/docs/introduction/regions) | Undated |
| Neon extensions | [Extensions](https://neon.com/docs/extensions/pg-extensions) | `pg_cron` 1.6 for Postgres 14 to 18 |
| Neon and Vercel | [Vercel integration](https://neon.com/docs/guides/vercel-managed-integration) | Undated |
| Supabase pricing | [Pricing](https://supabase.com/pricing) | Undated |
| Supabase backups | [Backups](https://supabase.com/docs/guides/platform/backups) | Undated |
| Supabase connections | [Connecting](https://supabase.com/docs/guides/database/connecting-to-postgres) | Undated |
| Turso pricing and PITR | [Pricing](https://turso.tech/pricing), [PITR](https://docs.turso.tech/features/point-in-time-recovery) | Undated |
| Turso transactions | [TypeScript reference](https://docs.turso.tech/sdk/ts/reference) | Undated |
| Turso and Supabase deal | [Turso post](https://turso.tech/blog/turso-is-joining-supabase), [Supabase post](https://supabase.com/blog/supabase-is-acquiring-turso) | 2026-10-02 |
| SQLite transactions | [Transactions](https://www.sqlite.org/lang_transaction.html) | Current docs |
| Postgres locking and isolation | [Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html), [Isolation](https://www.postgresql.org/docs/current/transaction-iso.html), [INSERT](https://www.postgresql.org/docs/current/sql-insert.html), [SELECT](https://www.postgresql.org/docs/current/sql-select.html), [Date/time functions](https://www.postgresql.org/docs/current/functions-datetime.html), [REVOKE](https://www.postgresql.org/docs/current/sql-revoke.html) | PostgreSQL 18.6 docs |
| Vercel storage | [Storage](https://vercel.com/docs/storage) | Updated 2026-09-03 |
| Vercel cron | [Usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) | Updated 2026-07-15 |
| Vercel functions | [Limits](https://vercel.com/docs/functions/limitations), [Fluid compute](https://vercel.com/docs/fluid-compute) | Both updated 2026-08-24 |
| Vercel Hobby | [Hobby plan](https://vercel.com/docs/plans/hobby) | Updated 2026-09-14 |
| Stripe | [Idempotent requests](https://docs.stripe.com/api/idempotent_requests), [Webhooks](https://docs.stripe.com/webhooks), [Refunds](https://docs.stripe.com/refunds), [Place a hold](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method), [Checkout Session create](https://docs.stripe.com/api/checkout/sessions/create), [ACH refunds](https://support.stripe.com/questions/refunds-for-ach-direct-debit-payments) | Undated; API v2 preview header `2026-09-30.preview` on the webhooks page |
| Upstash and Redis | [Upstash pricing](https://upstash.com/pricing/redis), [Upstash REST](https://upstash.com/docs/redis/features/restapi), [Redis EXPIRE](https://redis.io/docs/latest/commands/expire/) | Pricing undated |
| Drizzle | [Select](https://orm.drizzle.team/docs/select), [Transactions](https://orm.drizzle.team/docs/transactions), [Neon](https://orm.drizzle.team/docs/connect-neon), [Zod](https://orm.drizzle.team/docs/zod), [`select.ts` on GitHub](https://raw.githubusercontent.com/drizzle-team/drizzle-orm/main/drizzle-orm/src/pg-core/query-builders/select.ts), [npm](https://registry.npmjs.org/drizzle-orm/latest) | npm latest 0.45.4; docs on the 1.0 beta/RC line |
| Prisma | [Release status](https://www.prisma.io/docs/orm/release-status), [Transactions (Prisma 8 text)](https://www.prisma.io/docs/orm/prisma-client/queries/transactions), [npm](https://registry.npmjs.org/prisma/latest) | 7.10.1 stable; 8.0.0-rc.23 |
| House standards | `~/.claude/standards/react-nextjs.md`, `architecture.md`, `stack-decisions.md` | Baseline checked 2026-10-06 (per the standards file) |

**Could not verify.**
- A card refund time limit at Stripe (not stated in the pages I read).
- Whether Neon offers cross-region replication or a cross-region restore.
- Whether Turso Free databases are ever paused or archived for inactivity (the pricing page is silent).
- Whether the Supabase and Turso deal has closed.
- Redis persistence guarantees on Upstash Free.
- Supabase `pg_cron` availability and the price of the Small compute add-on.
- Neon Free commercial-use terms.
- Prisma 7's row-lock patterns, and Prisma 7 transaction details beyond a search summary.
- That Drizzle's `for()` is on the stable 0.45 line (I read the main branch).
- The Read Committed behavior of a one-statement lock plus sum, and the HTTP batch path for H1: both are inferences to prove in the concurrency test.
- Whether the Lakebase naming on one Neon page signals a product change.
