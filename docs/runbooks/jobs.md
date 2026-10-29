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

## Calling it

`Authorization: Bearer <PULSE_SECRET>`, method POST. Any other method, a missing secret, or a wrong one gets an empty 401 (wrong ones are counted per source address; past 20 in 10 minutes the answer is 429). The answer is counts only: `claimed`, `succeeded`, `retried`, `dead`, `lost`, `unrecorded`, `left`, `purged`, `holdsReleased`, `holdsScrubbed`. `claimed` equals `succeeded + retried + dead + lost + unrecorded`; a row dead-lettered without running counts in both `claimed` and `dead`. `lost` counts jobs whose claim was gone when their row lock was granted (another drain took them or they finished): nothing ran. `unrecorded` counts jobs whose failure could not be written down (the database refused the write); they keep their lock and are taken again once it lapses, and the rest of the batch still runs.

To show a job "tomorrow" in the demo: set `DEMO_CLOCK=on`, then POST `{ "asOf": "<ISO date-time with offset>" }`. The jobs run as of that time. It must be within 400 days of now. With `DEMO_CLOCK` off (the default) a body with `asOf` gets 400 and nothing runs. Switch it off again afterwards.

An `asOf` run treats the clock as `asOf` for everything, including the lock test. A row another drain is running right now has a lock that lapses after the real time, so at a later `asOf` it looks lapsed: the demo run takes it, and when the real drain finishes its re-check finds the claim gone and the outcome is `lost`. The job was not run twice by the real drain, but it cost an attempt. Use `asOf` when nothing is mid-run. A crashed `asOf` run leaves its rows locked until `asOf` plus 5 minutes, so a later real pulse will not touch them until the real clock passes that time; for an `asOf` in the future that can be a long wait. To free them sooner, set `status = 'pending'`, `locked_until = NULL`, `run_after = now()` on those rows (attempts already spent stay spent).

## Dead jobs

Query `jobs` where `status = 'dead'`: `last_error` holds the error kind and a redacted message, never the payload. To retry one, set `status = 'pending'`, `attempts = 0`, `finished_at = NULL`, `run_after = now()` in one UPDATE (the table's CHECKs refuse a half-edited row).

## Settings (Dave, after merge)

Add `PULSE_SECRET` (32+ characters) to the Vercel project and as the GitHub Actions secret `PULSE_SECRET`; land the pulse workflow (`.github/workflows/pulse.yml`, on branch `unit/U-005-pulse-workflow`); optionally create a Better Stack heartbeat and set `BETTERSTACK_HEARTBEAT_URL`.
