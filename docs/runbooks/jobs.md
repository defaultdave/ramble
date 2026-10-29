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

The pulse also deletes expired rate-limit rows and pings `BETTERSTACK_HEARTBEAT_URL` after a run that finished without error (a manual `asOf` run sends no heartbeat). A failed heartbeat is logged and never fails the pulse.

## Calling it

`Authorization: Bearer <PULSE_SECRET>`, method POST. Any other method, a missing secret, or a wrong one gets an empty 401 (wrong ones are counted per source address; past 20 in 10 minutes the answer is 429). The answer is counts only: `claimed`, `succeeded`, `retried`, `dead`, `left`, `purged`.

To show a job "tomorrow" in the demo: set `DEMO_CLOCK=on`, then POST `{ "asOf": "<ISO date-time with offset>" }`. The jobs run as of that time. It must be within 400 days of now. With `DEMO_CLOCK` off (the default) a body with `asOf` gets 400 and nothing runs. Switch it off again afterwards.

## Dead jobs

Query `jobs` where `status = 'dead'`: `last_error` holds the error kind and a redacted message, never the payload. To retry one, set `status = 'pending'`, `attempts = 0`, `finished_at = NULL`, `run_after = now()` in one UPDATE (the table's CHECKs refuse a half-edited row).

## Settings (Dave, after merge)

Add `PULSE_SECRET` (32+ characters) to the Vercel project and as the GitHub Actions secret `PULSE_SECRET`; land the pulse workflow (`.github/workflows/pulse.yml`, on branch `unit/U-005-pulse-workflow`); optionally create a Better Stack heartbeat and set `BETTERSTACK_HEARTBEAT_URL`.
