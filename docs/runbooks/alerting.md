# Logging, error tracking, and alerts

How Ramble records what happens and tells a person when something needs them. Built in U-007 (PRD-71, ADR 0007). Written for Dave and for any unit that raises an alert. The per-alert runbooks are U-099's; this page is the machinery they hang from.

## What exists

| Piece | Where | Does |
|---|---|---|
| Logger | `src/server/monitoring/logger.ts` | JSON lines on stdout (info, debug) and stderr (warn, error), each stamped with the request ID. Warnings and errors also go to Axiom when configured |
| Redaction | `src/lib/redact.ts`, `src/lib/scrubEvent.ts` | Applied to every log record and every Sentry event before it leaves the process |
| Request IDs | `src/server/monitoring/requestContext.ts` | `x-request-id` if the caller sent a safe one, else Vercel's `x-vercel-id`, else a new UUID. `withRequestContext(headers, work)` makes it available to every log line and error report inside `work` |
| Sentry (server) | `src/server/monitoring/sentry.ts`, started from `src/instrumentation.ts` | Captures errors from `onRequestError`, and opens issues for alerts |
| Sentry (browser) | `src/server/monitoring/SentryBrowserScript.tsx` | The loader script, mounted by the guest layout only. Never on checkout, host, or ops pages |
| Alerts | `src/server/monitoring/alerts.ts` | `alerts.raise(kind, severity, dedupeKey, context)` |

With none of the variables below set, nothing talks to the network: the logger still redacts and stamps request IDs, `alerts.raise` still writes its log line, and the Sentry and Axiom parts do nothing.

## Variables

All optional, all validated in `src/server/env.ts`. Rotation notes are in `secret-rotation.md`.

| Variable | Holds | Effect when unset |
|---|---|---|
| `SENTRY_DSN` | DSN of the server-side Sentry project | No error capture, no alert issues |
| `SENTRY_BROWSER_DSN` | DSN of the browser Sentry project (can equal `SENTRY_DSN`). Read when the guest pages are built, so it must be set for the build as well as at runtime (Vercel does both) | No browser script on guest pages |
| `AXIOM_TOKEN`, `AXIOM_DATASET` | Axiom ingest token and dataset; set both or neither | Warnings and errors stay on stdout only (Hobby keeps one hour of logs) |

## Raising an alert

```ts
import { alerts } from '@/server/monitoring/alerts';

alerts.raise('payment-mismatch', 'error', `order:${orderId}`, { orderId, amountMinor });
```

- **`kind`**: lowercase words joined by hyphens, at most 48 characters. It names the runbook: the link on the Sentry issue is `docs/runbooks/<kind>.md` on `main`. The unit that adds a kind also adds, or tells U-099 to add, that page.
- **`severity`**: `warning`, `error`, or `critical` (Sentry levels warning, error, fatal).
- **`dedupeKey`**: what makes two alerts the same problem: an order ID, a job name, a date. Letters, digits, and `: _ . / -`, at most 100 characters. The same `kind` and `dedupeKey` land in one Sentry issue, so a retry loop opens one issue and counts events on it.
- **`context`**: anything useful for the person reading. It is redacted and size-bounded before it is logged or sent.
- A malformed argument throws before anything is sent. A failure to reach Sentry is logged and never thrown, because alerts are raised from payment and job paths that must finish.

## Account setup (Dave, once)

These are Sentry and Axiom account settings. They cannot live in the repo without an organisation API token, and the demo has no account yet, so nothing below has been run against a live Sentry. The names are the Sentry UI's; check them when you set this up.

### Sentry projects

1. Create two projects: **ramble-server** (platform Next.js) and **ramble-browser** (platform JavaScript). Put the first DSN in `SENTRY_DSN` and the second in `SENTRY_BROWSER_DSN`, in Vercel, for Production and Preview.
2. In both, under Security & Privacy: turn on **Data Scrubber** and **Use Default Scrubbers**, and turn on **Prevent Storing of IP Addresses**. These are a second net behind Ramble's own redaction.
3. In ramble-browser, under Client Keys, open Configure on the key and enable the **Loader Script**. Turn **Session Replay** and **Performance** off in the loader. Replay would record guest pages. The browser SDK sets its own context; Ramble's redaction does not run in the browser, so the browser project must stay minimal (errors only).
4. Set **Allowed Domains** on the browser key to the production address once there is one.

### Alert rules

Create these under Alerts, Issue Alerts, in **ramble-server**. All three notify by email; the target is the ops address.

| Rule | When | If | Then | Throttle |
|---|---|---|---|---|
| Ramble alert, error or critical | A new issue is created, or an issue changes from resolved to unresolved | The event's tag `ramble_alert` equals `true` and its level is greater than or equal to `error` | Email the ops address | Once per issue per hour |
| Ramble alert, warning | A new issue is created | Tag `ramble_alert` equals `true` and level equals `warning` | Email the ops address | Once per issue per 24 hours |
| Unhandled server error | A new issue is created | Tag `ramble_alert` does not exist and level is greater than or equal to `error` | Email the ops address | Once per issue per hour |

The tag name and values come from `alertTag` in `src/lib/alerts.ts` and `prepareAlert`; a test pins them so the rules and the code cannot drift apart.

**The ops address.** Sentry's email action sends to a Sentry member, a team, or the issue owners, not to a bare address. The simplest route is a Sentry team named `ops` whose member signs in with the ops address. If the ops address is a shared mailbox, make it a member of that team. The address itself is not chosen yet (Dave to name it); it is never put in the repo.

**Check it works.** In each rule, use Send Test Notification, and confirm the email names the runbook (the issue's `runbook` tag). A real end-to-end check belongs to U-099's rehearsal: raise a throwaway alert with kind `alert-test` from a preview and confirm the email arrives with a link.

### Axiom

Create a dataset (for example `ramble-logs`) and an **ingest-only** API token scoped to it; put them in `AXIOM_DATASET` and `AXIOM_TOKEN`. The sink posts to the US endpoint (`api.axiom.co`); an EU organisation needs the endpoint changed in `src/server/monitoring/axiom.ts`. ADR 0007 notes Axiom's free-plan terms for commercial use are unconfirmed.

## What is redacted

- **By field name** (the whole value is replaced): password, secret, token, authorization, cookie, API and private keys, credentials, signature, card number and CVC, email, phone, guardian, birth date, DSN, and a short list of exact names (`card`, `pan`, `pin`, `otp`, `sig`, `auth`, `dob`).
- **By content, in every string**: emails, card numbers (checksum-valid, 13 to 19 digits), bearer and basic auth values, JWTs, Stripe, Axiom, Sentry, and GitHub key shapes, credentials in URLs, the segment after `/manage/`, `/gift/`, and `/orders/`, query parameters whose names look sensitive, and any opaque run of 32 or more letters, digits, `_`, or `-` that contains a digit or a capital (this catches capability tokens wherever they appear). UUIDs and Vercel request IDs are kept.
- **Errors** are rebuilt from name, message, stack, code, and cause only, so a database error's `detail` (which quotes the row) never travels.
- **Sentry** also drops request cookies and bodies, local variables, and everything about a user except an opaque ID, and the SDK is configured to collect none of them in the first place.
- Everything is bounded: depth 6, 50 array items, 100 keys, 1,000 values, 2,000 characters a string, 16,000 characters a record, and 16 KiB a log line.

To protect a new kind of field, add its name to `sensitiveKeyFragments` in `src/lib/redact.ts` and a row to the table in `src/lib/redact.test.ts`. Redaction is a net, not permission: do not pass a secret to a logger on purpose.

## Content Security Policy

Guest pages load `https://js.sentry-cdn.com`, which then loads `https://browser.sentry-cdn.com` and sends to the browser DSN's ingest host (`https://*.ingest.sentry.io`, or `*.ingest.us.sentry.io` for US organisations). The CSP (U-008a) needs `script-src` and `connect-src` entries for those on guest pages only. Checkout needs none, which is the point.
