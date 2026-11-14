# Background jobs and the pulse

How work that must happen after a change (emails, reminders, gift delivery, transfers, provider events) is written and run. Built in U-005 (design doc 4.2, ADR 0002 amendment, ADR 0007). Written for any unit that enqueues work and for Dave when running the demo.

## Writing a job

```ts
await db.transaction(async (tx) => {
  // ...the change...
  await enqueue(tx, { kind: 'send-email', payload, dedupeKey: `order:${id}:confirmed` });
});
```

- `enqueue` (`src/server/jobs/enqueue.ts`) takes the transaction, never the bare `db`, so the job exists exactly when the change does.
- A kind is an entry in `src/server/jobs/registry.ts`: a Zod schema for the payload, `maxAttempts`, and `handleIdempotent`. Adding a kind needs no migration. An unknown kind or a bad payload throws and writes nothing.
- A second enqueue of the same `dedupeKey` writes nothing and returns `null`. The key stays used after the job finishes.
- Delivery is at least once. A handler runs in its own transaction, gets the job ID (use it as the idempotency key for any provider call), and must be safe to run twice.
- Handlers and anything under `src/server/jobs/` read time only from the `Clock` they are given (`src/server/ports/clock/`); the lint rule bans `Date.now()` and `new Date()` there.

## How a job runs

`POST /api/pulse` claims up to 25 due jobs at a time (`FOR UPDATE SKIP LOCKED`), marks them running for 5 minutes, and runs each in its own transaction. Each claim spends an attempt. A failure rolls the handler back and retries after 30 seconds doubling to 6 hours (up to 20 percent shorter, by a jitter from the job ID). On the last attempt the job is `dead` and `alerts.raise('job-dead', ...)` fires with the kind and job ID. A running job whose lock lapsed is taken again; one with no attempts left is marked dead without running. One call stops after 200 jobs or 60 seconds and reports how many are `left`.

The pulse also deletes expired rate-limit rows, runs the hold upkeep (below), and pings `BETTERSTACK_HEARTBEAT_URL` after a run that finished without error (a manual `asOf` run sends no heartbeat, and neither does a run with `unrecorded` above zero, so the monitor alarms). A failed heartbeat is logged and never fails the pulse.

## Hold upkeep

After the drain and the rate-limit purge, the pulse runs two steps, each in batches of 100 until a short batch, 20 batches, or the call's 60 seconds:

- `releaseLapsedHolds` releases `active` holds past `expires_at` as `expired` and `paying` holds past `paying_until` as `payment_abandoned`. It only tidies rows: a lapsed hold stopped counting at its deadline, and the 15-minute block counts deadlines, not this job. Candidates are found with no lock; each session is then locked and every hold judged again at database time, so a hold that was converted or moved to `paying` in the meantime is left alone. A second run finds nothing. Each cleaned session's spaces-left tag is revalidated.
- `scrubReleasedHolds` replaces `device_key` and `ip_hash` with 64 zeros on holds released more than 30 days ago (`holdLimits.releasedRetentionDays`). The rows stay, because hold items, `superseded_by`, and later orders point at them.

Both judge time by the database clock, so a demo `asOf` run neither releases a hold a guest is using nor ages a hold early.

## Session horizon

After the drain, the pulse runs `extendSessionHorizon` (`src/server/db/sessions.ts`) on the pulse's clock: for every session template it runs `generateSessions` over `rollingRange(now)` (`src/lib/sessions.ts`), from the day before the UTC date of now to 12 weeks (84 days) ahead. A date that already has a session is left as it is, so a second pulse the same day creates nothing, and an edited or cancelled session is never rebuilt. The wall time in the host's zone holds across a daylight saving change. A template whose host zone is unusable is skipped. A template whose generation throws is counted, the next one still runs, and the pulse raises `session-horizon-failed` with the first error name and the count after the others' results are kept. Each experience that gained sessions has its schedule tag revalidated, even when another template failed; a revalidation that throws is logged and raises `session-horizon-revalidate-failed`. The answer's `sessionsCreated` counts the new rows. A failure of the whole step (such as reading the templates) is logged as `the session horizon could not be extended` and raises `session-horizon-failed`. None of these fail the pulse, and the next pulse asks for the same range again.

## Calling it

`Authorization: Bearer <PULSE_SECRET>`, method POST. Any other method, a missing secret, or a wrong one gets an empty 401 (wrong ones are counted per source address; past 20 in 10 minutes the answer is 429). The answer is counts only: `claimed`, `succeeded`, `retried`, `dead`, `lost`, `unrecorded`, `left`, `purged`, `holdsReleased`, `holdsScrubbed`, `sessionsCreated`. `claimed` equals `succeeded + retried + dead + lost + unrecorded`; a row dead-lettered without running counts in both `claimed` and `dead`. `lost` counts jobs whose claim was gone when their row lock was granted (another drain took them or they finished): nothing ran. `unrecorded` counts jobs whose failure could not be written down (the database refused the write); they keep their lock and are taken again once it lapses, and the rest of the batch still runs.

To show a job "tomorrow" in the demo: set `DEMO_CLOCK=on`, then POST `{ "asOf": "<ISO date-time with offset>" }`. The jobs run as of that time. It must be within 400 days of now. With `DEMO_CLOCK` off (the default) a body with `asOf` gets 400 and nothing runs. Switch it off again afterwards.

An `asOf` run treats the clock as `asOf` for everything, including the lock test. A row another drain is running right now has a lock that lapses after the real time, so at a later `asOf` it looks lapsed: the demo run takes it, and when the real drain finishes its re-check finds the claim gone and the outcome is `lost`. The job was not run twice by the real drain, but it cost an attempt. Use `asOf` when nothing is mid-run. A crashed `asOf` run leaves its rows locked until `asOf` plus 5 minutes, so a later real pulse will not touch them until the real clock passes that time; for an `asOf` in the future that can be a long wait. To free them sooner, set `status = 'pending'`, `locked_until = NULL`, `run_after = now()` on those rows (attempts already spent stay spent).

## After Pay on the fake gateway

When a guest taps Pay in the fake card form, the order does not wait for the pulse. `confirmFakePayment` (`src/server/actions/fakePayment.ts`) records the outcome at the fake, signs the event it emitted, and hands it to the webhook intake in the same process (`src/server/fakePaymentDelivery.ts`), so it runs the real path: signature, budget, `recordProviderEvent`, and the `process-provider-event` job. Once the intake has taken it, one `drainJobs` runs and the action waits for it, for up to 5 seconds, before it replies, so the page the guest lands on already shows the order as confirmed (or the failed try). The same drain is handed to `after()`, which keeps it alive past the reply if it is slow; a failure of it is caught and logged here. The drain runs as a clock 5 seconds ahead of now, because a job's `run_after` is the database's clock and a database clock slightly ahead of this process would otherwise leave the fresh job not yet due. A concurrent pulse is safe: claims use `SKIP LOCKED`. The drain may also run other due jobs, within the usual 200-job and 60-second caps.

- The fake keeps its payments and events in the one-row table `fake_gateway_state`, so a server instance that did not start the payment still knows it. The webhook secret stays random per process and needs no setting: the event is signed and checked in one process, and the webhook route still refuses anything from outside.
- If the intake refuses the delivery, the action throws (the log has the kind and the intake's outcome only) and the guest sees the "we're checking your payment" notice. The fake holds the payment and its event, Ramble does not, and nothing retries by itself; when the guest taps Pay again, the fake's last event for that payment is delivered again, and the intake stores it once however often it arrives. If the drain fails, the guest still gets their reply, the failure is logged by name only, and the job stays due for the next pulse or payment. A booking email delayed by design (the host notice) also waits for the next pulse or payment.
- The fake holds at most 2,000 payments, refunds, transfers, and reversals and 10,000 events (about 6.5 MB at both limits). Past either, every write answers `provider_unavailable` and payments are refused. To clear it on a demo database, delete the row: `DELETE FROM fake_gateway_state;`. The next payment makes a fresh one. Payments already made keep their orders, but the fake forgets them, so a guest still on a payment form from before the delete is refused.
- The row is one lock: every fake write takes turns. A load test on the fake measures that row, not checkout.

## Dead jobs

Query `jobs` where `status = 'dead'`: `last_error` holds the error kind and a redacted message, never the payload. To retry one, set `status = 'pending'`, `attempts = 0`, `finished_at = NULL`, `run_after = now()` in one UPDATE (the table's CHECKs refuse a half-edited row).

## Test console (`/ops/dev`)

For a testing deployment where nothing runs the pulse by itself. Ops and admin only, and refused on a production deployment (`VERCEL_ENV=production`) in the page and in every action. It lists the 50 newest jobs (status, attempts, due time, last error), runs one waiting job by hand, drains the queue, and triggers the pulse (no heartbeat). Each run uses the same drain and pulse code as `/api/pulse`.

The test clock is the cookie `ramble_dev_clock` (the tester's own browser, `/ops/dev` only, 8 hours): set a time, or move it on by hours or days, and the console's runs treat it as `asOf`, so reminders, review invites and gift sends come due. It needs `DEMO_CLOCK=on` and the same 400-day window as the pulse route; with `DEMO_CLOCK` off a stored time makes every run refuse until the clock is reset. Hold lapse is judged at database time and is not moved by it.

Running one job takes a waiting job whatever its due time. A test clock moved past a running job's lock lets run-one take a job a real drain is running, the same as a pulse `asOf` does (see above): the real drain's re-check then finds the claim gone and the job is `lost` to it, at the cost of an attempt. Use it when nothing is mid-run.

## Settings (Dave, after merge)

Add `PULSE_SECRET` (32+ characters) to the Vercel project and as the GitHub Actions secret `PULSE_SECRET`; land the pulse workflow (`.github/workflows/pulse.yml`, on branch `unit/U-005-pulse-workflow`); optionally create a Better Stack heartbeat and set `BETTERSTACK_HEARTBEAT_URL`.
