# Background jobs, email, and notifications

Researched 2026-10-18 for the Ramble industry-gap review.

## Summary

- **No ADR names an email provider, a template system, a sender domain, or a message log**, yet PRD-25, 27, 28, 33, 44 and 76 all need them. Pick for the real job: Resend Pro ([$20 a month for 50,000 emails](https://resend.com/pricing)) behind a `lib/email` wrapper (ARCH-8) with three adapters: Resend, a fake, and a spare Postmark. Templates are React Email in the repo. Every send is a row in a `messages` table updated by signed provider webhooks.
- **The "Hobby cron runs once a day" note is the smaller half of the scheduling problem.** Vercel documents cron as [best effort, never retried, sometimes delivered twice](https://vercel.com/docs/cron-jobs/manage-cron-jobs). So cron should be a tick over a Postgres `jobs` table where time is data (`run_at`), not the queue itself. This is the direction ADR 0002's research already took; the gap is the retry, dead-letter, and tick design. The same code runs on Hobby and Pro; only the tick source changes.
- **Vercel now sells the durable options ADR 0007 left open.** [Vercel Workflows](https://vercel.com/blog/a-new-programming-model-for-durable-execution) went generally available 2026-04-16 and Hobby includes [50,000 events a month](https://vercel.com/docs/workflows/pricing); [Vercel Queues](https://vercel.com/docs/queues) is in beta on all plans. Vercel's own guide calls Workflows ["a good default"](https://vercel.com/kb/guide/how-to-run-background-jobs-in-nextjs-on-vercel). Weighed and not picked for launch (reasons in J-section); named as the alternative with a trigger to reopen.
- **Free demo, in one line:** a fake email adapter plus an in-app dev mailbox is the default; real sends use Resend Free ([3,000 a month, 100 a day](https://resend.com/pricing)) only to allowlisted addresses and need a domain Dave controls (none is named in the plan docs). A free external ticker runs the job drain every 30 minutes, not every 5, because a tick or synthetic booking that keeps Neon awake every 5 minutes exhausts [Neon Free's 100 CU-hours](https://neon.com/docs/introduction/plans) in about half a month (my arithmetic, section J).
- **Deliverability is a setup task with a calendar, not a code task.** Own subdomain, SPF, DKIM, DMARC at `p=none` then tightened. [Google requires SPF or DKIM from every sender](https://support.google.com/a/answer/81126) and DMARC from anyone over 5,000 messages a day; Ramble is far below that, but spoofing of a brand with a 68,000-person newsletter (PRD section 2) is the reason to do it anyway. Provider approval and DNS checks take days, and December 1 is six weeks out.
- **The gift form is an email relay.** PRD-33 lets an anonymous visitor send a branded email to any address with a free-text message. In the demo the fake gateway removes the payment barrier, so the demo must default to a sink. Caps and a content rule are needed for the real job.
- **Add-to-calendar (PRD-25) is small:** an `.ics` endpoint plus provider links. Gmail's event markup is not available at launch (it needs [sender registration and a history of "hundreds of emails a day"](https://developers.google.com/workspace/gmail/markup/registering-with-google)). How Outlook treats each ICS `METHOD` could not be confirmed from primary sources; a client test matrix decides it.
- **SMS (PRD-31) stays Later.** [Twilio US long code is $0.0083 a segment plus carrier fees](https://www.twilio.com/en-us/sms/pricing/us), plus 10DLC registration and a consent and quiet-hours question for counsel (Q-16). A live "is this session on?" status page linked from every reminder deflects the same support load with no new vendor.

All prices, limits, and capability claims below were read from the linked page on 2026-10-18 unless a date is shown. Anything I could not confirm is marked **unconfirmed**; the list is in Sources.

Effort sizes are rough build sizes for one unit, not P4 estimates: **S** is under a day of agent build plus review, **M** is 2 to 4 days, **L** is a week or more.

**Sizing assumptions (mine, not from the PRD).** At the PRD's month-6 forecast of 1,800 bookings a month (PRD section 4 notes), 4 emails per booking (guest confirmation, reminder, review invite, host notice) is 7,200, plus about 650 weekly host statements, cancellations, and gifts: roughly 9,000 emails a month. A newsletter spike of 12,500 visitors in 3 hours (PRD-70) at a 2% booking rate is about 250 bookings and 500 immediate emails, under one a second. A weather day that cancels 30 outdoor sessions of 6 guests is about 210 emails in minutes (PRD-28). Resend's default limit is [10 requests a second per team](https://resend.com/docs/api-reference/rate-limit) and [batch takes 100 emails per call](https://resend.com/docs/api-reference/emails/send-batch-emails), so volume is not the constraint. The constraint is the free tier's 100 a day (a launch day will exceed it) and the 5-minute targets.

## Capability table

| Capability | Why Ramble needs it | Coverage today | Real-job pick | Free demo option and its limits | Effort | When |
|---|---|---|---|---|---|---|
| **E1** Transactional email provider and send wrapper | PRD-25, 27, 28, 33, 44, 76 | Gap. No ADR or stack-decisions row names a provider | Resend Pro, $20 a month for 50,000 emails, behind `lib/email` with adapters `resend`, `postmark` (spare), `fake` | Fake adapter writes to a DB sink and an in-app dev mailbox (default). Opt-in real sends on [Resend Free](https://resend.com/pricing): 3,000 a month, 100 a day, 3 domains, 1 webhook endpoint, 30-day retention. Needs a verified domain; `onboarding@resend.dev` [only delivers to the account owner](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain) | M | launch-critical |
| **E2** Email templates and rendering | PRD-76 (branded), PRD-77 (brand on every email), PRD-54 (help link in every email), content in PRD-25, 26, 27, 28, 33, 44 | Gap | React Email ([MIT](https://react.email/docs/introduction)) in the repo, one shared layout, rendered to HTML and plain text inside the wrapper, Vitest snapshots | Same. `email dev` preview and [Mailpit](https://mailpit.axllent.org/) locally, both free | M | launch-critical |
| **E3** Sender domain authentication (SPF, DKIM, DMARC, return path) | PRD-76 "authenticated sending domain" | Gap | Transactional subdomain, provider DKIM and custom return path, DMARC `p=none` with reports at launch, tighten after clean weeks, Google Postmaster Tools | Needs a domain Dave controls; none named. Without one, fake adapter only. [Postmark's free DMARC monitor](https://dmarc.postmarkapp.com/): weekly email reports, 7 days of history | S | launch-critical |
| **E4** Message log, delivery webhooks, bounce and complaint handling | PRD-25, 28, 44 "within 5 minutes" must be provable; PRD-51 booking history; "I never got it" support load (RK-04) | Gap. ADR 0002 dedupes payment events only | `messages` table (template, recipient, booking, provider ID, timestamps), signed webhook route sets status and a suppression flag, ops view with "resend" | Fake adapter simulates every status. Resend test addresses `delivered@`, `bounced@`, `complained@`, `suppressed@resend.dev` [count against quota](https://resend.com/docs/dashboard/emails/send-test-emails) | M | launch-critical |
| **J1** Outbox and durable jobs table (event-driven sends, retries, dead letters) | PRD-25, 28, 44; no double send (PRD-22 spirit); Stripe says [process webhooks through a queue](https://docs.stripe.com/webhooks) | Partial. ADR 0002 research suggests a `jobs` table; no ADR decides it | `jobs` rows written in the same transaction as the state change, drained with `FOR UPDATE SKIP LOCKED`, backoff, dead-letter after N tries, `after()` fast path, provider [Idempotency-Key](https://resend.com/docs/dashboard/emails/idempotency-keys) (24-hour window) | Identical code, no cost | M | launch-critical |
| **J2** Scheduler tick for time-based work (reminders, gift delivery and expiry, review invites, weekly transfers, hold cleanup, reconciliation) | PRD-27 (within an hour), PRD-33 (within 5 minutes), PRD-29, PRD-47, ADR 0003 | Partial. ADR 0007: Hobby cron once a day, Pro per-minute, demo by hand | Vercel Cron every minute on Pro calling a secured, idempotent drain route; timers are `run_at` rows | Hobby daily cron as a safety net, plus a free external ticker every 30 minutes (table in section J), plus a manual "run now" and a time-machine control | S | launch-critical |
| **J3** Inbound webhook intake (Stripe, email provider) | PRD-22, 25, 28, 47 | Partial. ADR 0002 events table, ADR 0003 thin route shell | Verify signature on the raw body, insert with unique event ID, return 2xx, process through J1; never assume order | Same code. Stripe sandbox retries only [three times over a few hours](https://docs.stripe.com/webhooks); the demo uses the fake gateway anyway | S | launch-critical |
| **J4** Job and email monitoring (tick heartbeat, dead letters, 5-minute checks) | PRD-71, PRD-25/28/44 timing; cron can [miss runs with no log](https://vercel.com/docs/cron-jobs/manage-cron-jobs) | Gap. ADR 0007 covers errors, uptime, vitals | Ops "Jobs and messages" page; tick heartbeat to [Sentry Cron Monitors](https://sentry.io/pricing/) (1 included, +$0.78 each on Team) or [Healthchecks.io](https://healthchecks.io/pricing/); alert on a dead letter or no tick in 5 minutes; p95 trigger-to-accepted query | Admin page plus Healthchecks Hobbyist (20 checks free; commercial use **unconfirmed**) | S | launch-critical |
| **N1** Gift email delivery and abuse controls | PRD-33; industry norm for any form that emails a third party | Partial. ADR 0002/0003 treat gifts as vouchers; nothing covers email abuse | Job at delivery time; caps per sender, device, and recipient; plain-text message, length-limited, no URLs; "I did not expect this" link feeding suppression; send only after capture | Gift emails go to the sink unless the recipient is allowlisted | S | launch-critical (if gifting is in the sponsor deliverable, Q-13) |
| **N2** Non-production send safety | Previews, agent runs, and the public demo must never email strangers | Gap | `EMAIL_MODE` = `sink`, `allowlist`, or `live`; `live` only on production | Default `sink` everywhere else | S | launch-critical |
| **C1** Add-to-calendar links and `.ics` | PRD-25 "add-to-calendar link", Confirmation wireframe 06 | Gap | `.ics` endpoint keyed by the booking token, the same file attached to the confirmation, plus Google, Outlook, and Yahoo links; `ical-generator` ([MIT](https://github.com/sebbo2002/ical-generator)); stable `UID`, rising `SEQUENCE`, `CANCEL` on cancellation | Same, free | S | launch-critical |
| **C2** Host calendar feed (subscribable `.ics` URL) | PRD-42 "no double entry"; hosts on calendars and DMs (about 40%) | Gap. Not in any PRD row | Per-host secret URL listing Ramble sessions with bookings | Same | S | later |
| **H1** Host notices: per booking (PRD-44), payout statement email (PRD-47), day-before roster, digest preference | PRD-44, 45, 47 | Partial. Only PRD-44 is a requirement | Per-booking email at launch; payout email when the weekly transfer runs; roster and digest as Suggestions | Same adapter | S | launch-critical for PRD-44; digest before scale |
| **R1** Reply-to, inbound, and support routing | RK-04: 60 to 300 support emails a week; PRD-54 | Gap. PRD-54 covers help pages only | `Reply-To` a monitored support address, never `noreply`; help link in every email; "is it on?" status link in reminders (Suggestion) | `Reply-To` to Dave's inbox or none | S | launch-critical |
| **M1** Newsletter opt-in sync to the newsletter platform | PRD-15 records opt-in; PRD-58 and G4 count subscribers; guardrail on list growth | Gap. The newsletter platform is not named in the PRD | Job pushes `newsletter_optins` rows (time, source) to the platform's API behind a wrapper; marketing never sent from the transactional subdomain | Stub adapter writing to a table | S | before scale (recording the opt-in is already launch-critical in PRD-15) |
| **F1** Second email provider as failover | PRD-28 five-minute promise vs a provider outage; Resend had a [roughly 1.4-hour sending outage on 2026-04-10](https://isdown.app/status/resend/outage-history) (status aggregator, not Resend's own page) | Gap | Wrapper retries on 5xx, then falls back to Postmark after N failures; second domain authentication done in advance | None needed | S | before scale |
| **S1** SMS alerts for same-day cancellations | PRD-31 (Later) | Gap, deliberately | Twilio behind `lib/sms`; consent captured separately at checkout; counsel first | No real SMS; stub writes to the dev mailbox | M | later |
| **P1** Notification orchestration platform (Knock, Novu, Courier) | Preference center across 3 or more channels | Gap, not needed yet | None. A typed in-house registry: event, recipients, channel, template | None | S for the registry | later |

## E1 gap: the email provider

Options weighed for about 9,000 emails a month, transactional only.

| Provider | Free tier | Entry paid | Log retention | Notes |
|---|---|---|---|---|
| [Resend](https://resend.com/pricing) | 3,000 a month, 100 a day, 3 domains, 1 webhook endpoint | Pro $20 for 50,000; overage $0.90 per 1,000; 10 domains; 5 webhook endpoints | 30 days | Maker of React Email. [Scheduled sends up to 30 days](https://resend.com/docs/dashboard/emails/schedule-email), not over SMTP. Webhooks signed with [Svix headers](https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests); [automatic retries over about a day, endpoint auto-disabled if it keeps failing](https://resend.com/docs/dashboard/webhooks/retries-and-replays) |
| [Postmark](https://postmarkapp.com/pricing) | 100 a month, no expiry | Basic $15 for 10,000; overage $1.80 per 1,000 | 45 days | New accounts [cannot send outside their own domains until approved](https://postmarkapp.com/support/article/1084-how-does-the-account-approval-process-work) (typically under 24 hours on weekdays). Separate transactional and broadcast streams. Dedicated IPs only at 300,000 or more emails a month |
| [Amazon SES](https://aws.amazon.com/ses/pricing/) | New AWS customers: up to $200 in credits, free plan for 6 months | Essentials $0.16 per 1,000 for new accounts since [2026-07-21](https://aws.amazon.com/about-aws/whats-new/2026/07/amazon-ses-pricing-plans/); $0.10 per 1,000 à la carte | You build it | [Sandbox](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html): 200 messages a day, 1 a second, verified recipients only; production access reviewed within 96 hours. Bounce and complaint handling and a log UI are yours to build |
| [Mailgun](https://www.mailgun.com/pricing/) | 100 a day, 1 domain, 1-day log retention | Basic $15 for 10,000; Foundation $35 for 50,000 | 1 to 5 days | Log retention too short for support |
| [SendGrid](https://www.twilio.com/en-us/sendgrid) | Free trial only on the page read; volume and length not stated | **Unconfirmed** | **Unconfirmed** | Not weighed |
| Brevo | **Unconfirmed**; pricing page did not load | | | Not weighed |

**Pick: Resend, with Postmark as the tested second adapter.**
- At 9,000 a month price is not the lever: about $20 on Resend Pro, $15 on Postmark Basic, about $1.44 on SES Essentials (my arithmetic). SES adds build work (bounce handling, templates, log UI) for a client with no engineers (C-04). It becomes the pick if volume passes roughly 500,000 a month.
- Resend's free tier lets the demo send real mail through the same adapter the real job uses. Postmark's free tier (100 a month) cannot.
- I found no independent deliverability benchmark for Resend or Postmark. Before launch, send to a seed list (Gmail, Outlook, Yahoo, iCloud) from the real domain and read where it lands. Status-page history is thin evidence only.
- Do not buy a dedicated IP at this volume. A new IP has no reputation and 9,000 a month cannot warm one; shared pools are the right call.
- Timeline: Postmark approval and SES production access are the slow steps (under 24 hours to 96 hours). Resend showed no manual approval on the pages read (**unconfirmed**). Start domain and provider setup in week one.

## E2 gap: templates

| Option | For | Against |
|---|---|---|
| React Email in the repo | [MIT, from Resend, works with any provider](https://react.email/docs/introduction) (lists Postmark, SES, Mailgun, SendGrid, Nodemailer); templates are code the agents can test and the review agent can read | Maintenance activity date and current major version not shown on the pages read (**unconfirmed**) |
| Provider-hosted templates | Non-engineers can edit | Lives outside the repo and review; ties templates to one vendor; harder to test (my reasoning) |
| MJML or Maizzle | Mature in the email world | Not researched |

Rules for the template unit:
- About 13 templates: booking confirmation, reminder, guest-cancel confirmation, host or Ramble cancellation, gift to recipient, gift receipt to buyer, host new booking, host cancellation, host payout statement, review invite, sign-in link (ADR 0002), group request (PRD-35), ops alert.
- Render to HTML and plain text inside the wrapper and pass strings to the provider, so adapters stay swappable.
- Keep HTML under about 100 KB: Gmail [clips near 102 KB](https://mxtoolbox.com/dmarc/email/email-clipping) (vendors document it; Google does not publish a limit).
- Show session times in America/New_York with the zone named.
- No promotional content in transactional mail. Google's guidance [warns against mixing it in](https://support.google.com/a/answer/81126) and the FTC judges mixed messages by [primary purpose](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business).
- Tests: a Vitest snapshot per template from fixtures, a failing test on the string `undefined`, a link check against Mailpit in the end-to-end run.
- PRD-69 names guest, host, and admin flows, not email. Ask whether emails are in the WCAG 2.2 AA scope; semantic HTML, alt text, and contrast cost nothing to include.

## E3 gap: deliverability setup

| Control | What to do | Source |
|---|---|---|
| SPF or DKIM, all senders | Provider DKIM (1024-bit or longer for personal Gmail), SPF include; spam rate under 0.3% in Postmaster Tools, aim under 0.1% | [Google](https://support.google.com/a/answer/81126) |
| DMARC | Google requires it from senders over 5,000 messages a day to Gmail, at `p=none` minimum. Ramble is below that. Publish it anyway, with reports to a free monitor | Google; [Postmark DMARC monitor](https://dmarc.postmarkapp.com/) |
| Outlook.com | Rules for senders over 5,000 a day took effect 2025-05-05 (SPF, DKIM, DMARC). Microsoft's own post would not load for me; secondary summaries disagree on Junk versus reject (**unconfirmed**). Treat as the same bar | [Microsoft post](https://techcommunity.microsoft.com/blog/outlook/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730), [dmarcian](https://dmarcian.com/microsoft-enforces-spf-dkim-dmarc/), [egressif](https://egressif.io/resources/sender-requirements/microsoft) |
| Subdomain | [Resend recommends sending from subdomains](https://resend.com/docs/dashboard/domains/introduction). Put transactional mail on its own subdomain, separate from wherever the newsletter sends, so a newsletter complaint spike cannot sink booking confirmations (my reasoning). Ask which domain the newsletter uses | Resend |
| Return path | Custom return-path subdomain so bounces align with SPF | Resend (optional feature) |
| DMARC rollout | Week 1 `p=none` with reports. After 2 clean weeks `p=quarantine`. After 2 more `p=reject`. Coordinate with any DMARC record the newsletter already has | Practice, not a cited rule |
| Tracking | Turn off open and click tracking for transactional mail; opens are not a signal Ramble acts on, and PRD-73 favors less tracking | Recommendation |
| CAN-SPAM | Transactional messages are [exempt from most provisions](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) but not from false routing information; mixed content is judged by primary purpose; penalties up to $53,088 per email. The review invite (PRD-29) and any "other dates" or newsletter line need care: keep the invite single-purpose. Counsel question (Q-16) | FTC |
| Link scanners | Corporate scanners (Safe Links, Mimecast, Proofpoint) open links before the reader does and can burn a single-use token. Manage-booking and sign-in links (ADR 0002) should show a button whose POST does the work, not consume on GET. There is [no authoritative standard, only vendor and project reports](https://github.com/orgs/supabase/discussions/41618) | Supabase discussion |

## J-section: durable jobs and the tick

Why the current notes are not enough:
- ADR 0007 says Hobby cron runs once a day with up to 59 minutes of imprecision. [Confirmed](https://vercel.com/docs/cron-jobs/usage-and-pricing) (page updated 2026-07-15).
- Vercel also documents that cron delivery is best effort, a missed run leaves no log, a run can be delivered twice, and a failed run is not retried. Its advice is [locks plus idempotent, reconcile-since-last-run handlers](https://vercel.com/docs/cron-jobs/manage-cron-jobs). So cron is a tick, not a queue.
- Reminders must land within an hour either side (PRD-27) and gift emails within 5 minutes of delivery time (PRD-33). Stripe also tells integrators to [acknowledge webhooks fast and process through a queue](https://docs.stripe.com/webhooks).

### Options

| Option | Timers up to 12 months (gift expiry, far-off gift dates) | Free demo | Real-job cost | Fit and lock-in | Verdict |
|---|---|---|---|---|---|
| **Postgres `jobs` rows plus a tick** | Yes: `run_at` is data | Free; tick source below | No new vendor; Pro cron is billed as ordinary function use | Own the retry and dead-letter code; time is testable with a fake clock; matches ADR 0002's backdated-seed demo | **Pick** |
| [Vercel Workflows](https://vercel.com/docs/workflows) (GA 2026-04-16 per [Vercel](https://vercel.com/blog/a-new-programming-model-for-durable-execution)) | Yes: [sleep has no limit](https://vercel.com/docs/workflows/pricing) | Hobby: 50,000 events a month, 1 GB written; run data kept 1 day | Pro: $0.02 per 1,000 events, $0.50 per GB written | `'use workflow'` directives cannot sit behind a wrapper the way an SDK can; open-source SDK with a [Postgres world](https://workflow-sdk.dev/docs/deploying) for leaving Vercel; v5 is still a beta tag; Vercel recommends it as the default | **Named alternative.** Spike on the cancellation fan-out |
| [Vercel Queues](https://vercel.com/docs/queues) (beta, all plans) | No: delay and TTL cap at [7 days](https://vercel.com/docs/queues/pricing) | Hobby: first 1,000,000 operations | Regional per-operation rates | Beta; good for fan-out, not for timers | Not now |
| [Inngest](https://www.inngest.com/pricing) | Limited: [longest run, sleeps included, is 30 days Free and 90 days Pro](https://www.inngest.com/docs/usage-limits/inngest) | Free: 50,000 executions, 5 concurrent steps, no overage (it pauses at quota) | Pro from $99 a month with 1M executions | Hosted engine and dashboard; long timers still need the DB | Alternative if a hosted dashboard becomes worth $99 a month |
| [Upstash QStash](https://upstash.com/pricing/qstash) | Free: max delay 7 days; pay as you go: 1 year | Free: 1,000 messages a day, 10 active schedules, 3-day logs | $1 per 100,000 messages | HTTP-callback queue | Good demo ticker; not the engine |
| [Trigger.dev](https://trigger.dev/pricing) | Waits are checkpointed | Free: $5 credit a month, 20 concurrent runs, 10 schedules, 1-day logs | Hobby $10, Pro $50, plus $0.25 per 10,000 runs and compute | Runs tasks on its own infrastructure; heavy for sending mail | No |
| Resend `scheduled_at` | Max 30 days; cancel and reschedule are API calls | In the free tier | none | Reminders would drift from the database when a booking is cancelled or moved; gifts can be 12 months out | No |
| `pg-boss` or Graphile Worker | n/a | n/a | n/a | These Postgres queues assume a long-lived worker process, which Vercel Functions are not (inference from their design; `pg-boss` not checked) | No |

### Recommended design

1. **Write the job in the same transaction as the fact:** booking confirmed, session cancelled, gift bought. A unique `dedupe_key` (kind plus booking ID) stops doubles. This is the outbox pattern and fits ADR 0002 rule 5.
2. **Timers are rows.** Reminder `run_at` is session start minus 24 hours, computed in the session's time zone. Booked inside 24 hours: no separate reminder (PRD-27 says the confirmation carries it). Cancel or move a session and the same transaction deletes or rewrites its pending rows.
3. **Handlers re-read state and skip if stale.** A reminder for a cancelled booking, a started session, or a job past its `not_after` does nothing. This also protects after a tick outage and after a database restore (PRD-75), so a restore never fires a day of old reminders.
4. **Drain:** select due rows with `FOR UPDATE SKIP LOCKED`, lease them (`locked_until`), retry with backoff (for example 30 seconds, 2 minutes, 10 minutes, 1 hour), dead-letter after N tries and alert.
5. **Fast path:** after the commit, call the drain with `after()` ([stable since Next.js 15.1](https://nextjs.org/docs/app/api-reference/functions/after)). The row, not `after()`, is the guarantee; if the function dies, the tick picks it up.
6. **Tick:** a secured route (the [`CRON_SECRET` bearer pattern](https://vercel.com/docs/cron-jobs/manage-cron-jobs)), idempotent, with a lock against overlap, that processes everything due since the last success.
7. **Fan-out (PRD-28):** a cancel writes one parent job; it writes one child per booking (refund plus email), each idempotent with the keys from ADR 0003. Bound the parallelism against the provider's 10 requests a second.
8. **Weekly transfers (ADR 0003):** one job per booking, keyed as ADR 0003 already says.
9. **Time is injectable:** `drainDue(now)` takes a clock. Tests and the demo's time machine use it, and ADR 0002's backdated gift seeds drain through the same path.

Switch to Workflows or Inngest if: the tick misses a window in production, job kinds pass about a dozen with branching sagas, or ops wants replay tooling the admin page cannot give. Vercel's own guide leans to Workflows, so spike one flow at the walking skeleton rather than assuming.

### Demo tick sources

| Source | Interval and limits | Notes |
|---|---|---|
| Vercel Hobby cron | Once a day, [any minute inside the hour](https://vercel.com/docs/cron-jobs/usage-and-pricing); 100 cron jobs | Safety net only |
| [Upstash QStash](https://upstash.com/pricing/qstash) schedule | Free: 10 schedules, 1,000 messages a day (a 1-minute schedule is 1,440 a day, so use 5 minutes or longer) | Free-tier commercial-use terms **unconfirmed** |
| [cron-job.org](https://cron-job.org/en/) | Up to once a minute; free, donation-funded; job limits not stated | A third party sees the secret header |
| [Cloudflare Workers cron](https://developers.cloudflare.com/workers/platform/limits/) | Free: 5 cron triggers per account, 100,000 requests a day, 10 ms CPU | Adds a second vendor |
| [GitHub Actions schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) | Minimum 5 minutes, delayed at busy times, jobs can be dropped, disabled after 60 days without activity in public repos. Public repos are free; [private repos get 2,000 minutes a month](https://docs.github.com/en/billing/concepts/product-billing/github-actions) | 8,640 runs a month at 5 minutes. The repo is now private (ADR 0007 change), and per-job minute rounding is **unconfirmed** |
| Manual protected route | n/a | ADR 0007 today |

**The Neon constraint.** [Neon Free gives 100 CU-hours a project and suspends compute after 5 idle minutes, which cannot be turned off](https://neon.com/pricing); its plans page says that is [about 400 hours at 0.25 CU](https://neon.com/docs/introduction/plans), and exhausted compute stays suspended until the next period. A month is about 730 hours. A tick (or the synthetic booking in ADR 0006 and 0007) every 5 minutes keeps compute awake all month and runs out around day 17 (400 hours is about 16.7 days). Every 30 minutes keeps it awake about 20% of the time, roughly 37 CU-hours (my arithmetic, assuming the 0.25 CU floor). So the demo tick is 30 minutes, which still meets PRD-27's hour of tolerance. The 5-minute gift target is shown with the manual run-now control. For the real job, the always-on floor is a budget line: 0.25 CU for 730 hours at [$0.106 per CU-hour](https://neon.com/pricing) is about $19 a month (my arithmetic; minimum size on paid plans unconfirmed).

## J3 gap: webhook intake

| Item | What the docs say | Design |
|---|---|---|
| Stripe retries | Live: up to three days with backoff. Sandbox: three tries over a few hours. Manual re-send from the Dashboard works for 15 days, from the CLI for 30 days. [Source](https://docs.stripe.com/webhooks) | Return 2xx after storing; replay is possible for a month |
| Stripe ordering and duplicates | No ordering guarantee; track event IDs | Unique `provider_event_id`; handlers read current state |
| Resend webhooks | [Eleven email event types](https://resend.com/docs/dashboard/webhooks/event-types) including `bounced`, `complained`, `delivery_delayed`, `suppressed`; retries over about a day; endpoint auto-disabled if it keeps failing | Same intake table; alert if no event for N hours, since a disabled endpoint is silent |
| Route shape | Verify signature on the raw body, insert, return 2xx, nothing else | Matches ADR 0003's thin shell; processing runs through J1 |

## C1 gap: calendar invites

| Option | Notes | Verdict |
|---|---|---|
| Links only | Google's template URL is [not officially documented by Google](https://github.com/InteractionDesignFoundation/add-event-to-calendar-docs/blob/master/services/google.md) but stable in practice: `text`, `dates` (UTC with `Z`, both halves), `ctz`, `details`, `location` | Include |
| `.ics` attachment and endpoint | Calendar-aware clients show an "Add to calendar" control for an [attached `text/calendar` part](https://nodemailer.com/message/calendar-events). Needed for Apple Calendar | Include |
| Gmail event markup | Needs [registration with Google and a history of hundreds of emails a day to Gmail for weeks](https://developers.google.com/workspace/gmail/markup/registering-with-google) | Revisit after launch |
| `add-to-calendar-button` web component | [Elastic License 2.0](https://github.com/add2cal/add-to-calendar-button), not an open-source license; needs JavaScript, which emails lack | Avoid |

ICS rules (from [RFC 5546](https://www.rfc-editor.org/rfc/rfc5546.html)):
- `UID` is the key; keep it stable per booking. Raise `SEQUENCE` on a time change and on cancel (it must rise with `CANCEL`).
- `METHOD:PUBLISH` is for events with no reply expected. `REQUEST` asks recipients to respond and would route RSVPs toward Ramble. Use `PUBLISH`.
- Use UTC times, or a time zone plus a VTIMEZONE block (`ical-generator` advises a generator for this).
- **Unconfirmed client behavior:** one developer reports Outlook web shows `PUBLISH` only as a notification, and `ical-generator` says a method is needed for Outlook to show an invitation; one source says `PUBLISH` with a reused `UID` makes a new event rather than updating. Test Gmail (web, iOS, Android), Apple Mail, and Outlook (new, classic, web) before launch and decide from the results. Because updates may not apply, say the change in the email text and on the manage page too.
- Libraries: `ical-generator` is MIT. [`ics`](https://github.com/adamgibbons/ics) supports method, UID, sequence, status; its license was not visible on the page read.

## N1 and N2 gaps: gift abuse and non-production safety

- **The risk.** The gift form (PRD-33, wireframe 05b) emails any address with a sender-written message, from Ramble's authenticated domain. Misuse harms the recipient and Ramble's sender reputation; Google's 0.3% spam-complaint line is the cliff.
- **Real job:** capture payment first (the cost itself deters abuse); cap sends per device, per sender, per recipient, and per recipient domain per day; plain text only, length-limited, links stripped; check the suppression list; "I did not expect this" link that suppresses the recipient and flags the order. Overlaps the security and abuse review; keep the caps in the notifications module so they apply to the sign-in link and a "resend my confirmation" form too.
- **Demo:** the fake gateway "captures" for free, so a public demo would be a free relay. Default `EMAIL_MODE=sink`; use `allowlist` only for a live presentation, with addresses Dave controls.
- **Same switch for agents and previews:** agent-written code, seeds, and preview deployments carry email addresses. Only `live` on production can reach anyone else.

## S1 gap: SMS (later)

| Item | Finding |
|---|---|
| Price | [US long code $0.0083 per segment plus $0.0035 to $0.005 carrier surcharge; number $1.15 a month; toll-free number $2.15 a month](https://www.twilio.com/en-us/sms/pricing/us) |
| Registration | US long-code traffic needs [A2P 10DLC registration](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc); unregistered traffic pays extra carrier fees. Brand, vetting, and monthly campaign fees disagree across sources (about $4 to $4.50 low-volume brand, $15 vetting, $1.50 to $10 a month) and approval time is not stated: **unconfirmed** |
| Consent | FCC revocation rule effective 2025-04-11: honor opt-outs in a reasonable time, not over 10 business days, with plain words like STOP ([summary](https://nixonpeabody.com/insights/alerts/2025/04/11/fcc-partially-delays-new-tcpa-consent-revocation-rules)). Quiet-hours rules were not confirmed. Counsel question (Q-16) |
| PRD fit | Phone is optional in the checkout wireframe; PRD-31 needs a separate consent checkbox and a stored consent record |
| Cheaper first step | A live session-status page linked from every reminder, since "is this still on?" is most of the inbox (PRD section 3, RK-04). No new vendor |
| Not researched | Telnyx, Vonage, AWS End User Messaging |

## P1 gap: notification platforms (later)

[Knock](https://knock.app/pricing): free to 10,000 messages a month, Starter $250 for 50,000. [Novu](https://novu.co/pricing): free to 10,000 workflow runs, Pro from $30 a month, self-hosting listed as an Enterprise option. Both are priced for apps with many channels and user-set preferences. Ramble has email now and SMS later. Build one typed registry (event to recipients to channel to template) and revisit at three channels or a real preference center.

## H1 and R1 notes (Suggestions, not requirements)

Logged here per the scope rule; none is built unless the PM adds it.
- **Day-before host roster email** with the guest list link (PRD-45 has the page, not the nudge).
- **Weather go/no-go prompt** to the host at the stated decision time (PRD-12, PRD-27 promise guests a final-call time; nothing prompts the host, and no answer should escalate to ops).
- **Host digest preference** so a busy host does not get 40 emails a week.
- **Payout statement email** when the weekly transfer runs (PRD-47).
- **Session-status link** in reminders (see S1).
- **Host with a bounced address:** ops alert plus a dashboard banner, since PRD-44's email is how hosts learn of bookings.

## Proposed ADR changes

1. **New ADR 0011, "Email, notifications, and background jobs" (R13).** It would say:
   - Email provider: Resend, with `lib/email` adapters `resend`, `fake`, and a spare `postmark`; templates in React Email rendered to HTML and text inside the wrapper; a `messages` table; signed webhook route; `EMAIL_MODE` of `sink`, `allowlist`, or `live`.
   - Domain plan: transactional subdomain, SPF, DKIM, custom return path, DMARC `p=none` then tightened; seed-list inbox test before launch; no dedicated IP.
   - Jobs: Postgres `jobs` outbox in the same transaction; `FOR UPDATE SKIP LOCKED` drain; staleness guards; dead-letter and alert; `after()` fast path; tick is Vercel Cron per minute on Pro.
   - Calendar: `.ics` endpoint plus attachment plus provider links; `ical-generator`; `METHOD:PUBLISH`; client test matrix.
   - Named alternatives and the conditions to reopen: Vercel Workflows (spike at the walking skeleton), Inngest, a second provider.
   - Out of scope for launch: SMS, notification platform, host calendar feed.
2. **Amend ADR 0007, scheduled-jobs bullet and "What would change".** Replace "the demo triggers these jobs from a protected route" with: jobs drain from a tick; Hobby has a daily cron plus an external ticker every 30 minutes; Pro has per-minute cron; a heartbeat alerts on a missed tick. Add the Neon Free compute-hours limit to the synthetic-booking cadence (ADR 0006, 0007): not every few minutes on the demo. Add Sentry Cron Monitors or Healthchecks.io to the monitoring list behind a wrapper.
3. **Amend ADR 0002.** Add `jobs`, `messages`, and webhook intake (extend the provider events table to email events) to the schema list; `guests.email_status` and a per-address suppression flag; the staleness rule; a note that a restore must not replay old reminders; the always-on Neon floor in the real-job cost.
4. **Amend ADR 0003.** The webhook route verifies, stores, returns 2xx, and enqueues (Stripe's async-queue guidance). Host and weather cancellations (PRD-28) run as a fan-out of idempotent jobs. Weekly transfers run as per-booking jobs. Gift emails send only after capture.
5. **Amend ADR 0005.** The in-app admin gains a "Jobs and messages" area: failed jobs with retry, message log per booking with "resend confirmation," suppression list, and the demo time-machine control.
6. **Amend ADR 0006.** Add: a real-database test that parallel drains never double-process a job; fake-clock tests for reminders, gift delivery, and expiry; template snapshots; Mailpit assertions in the end-to-end suite; a check that p95 trigger-to-accepted is under the PRD's 5 minutes.
7. **Amend `.claude/standards/stack-decisions.md`.** Add rows for the email provider, the job tick, and (later) SMS, each behind a wrapper (ARCH-8), plus the `EMAIL_MODE` variable.
8. **PRD follow-ups (the PRD is signed, so as open questions rather than edits):**
   - Q-23: which domain sends Ramble's email and who controls its DNS.
   - Q-24: which newsletter platform Ramble uses, and does it have an API (M1).
   - Q-25: is the review invite (PRD-29) treated as transactional; counsel (Q-16).
   - Note on PRD-25: "add-to-calendar link" is met by links plus `.ics`.
   - Ask whether PRD-69 covers email.

## Sources

Read 2026-10-18 unless dated. Secondary sources are marked.

| Topic | Link | Used for |
|---|---|---|
| Resend | [pricing](https://resend.com/pricing), [idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [scheduled sends](https://resend.com/docs/dashboard/emails/schedule-email), [event types](https://resend.com/docs/dashboard/webhooks/event-types), [verify webhooks](https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests), [retries](https://resend.com/docs/dashboard/webhooks/retries-and-replays), [rate limit](https://resend.com/docs/api-reference/rate-limit), [batch](https://resend.com/docs/api-reference/emails/send-batch-emails), [test addresses](https://resend.com/docs/dashboard/emails/send-test-emails), [domains](https://resend.com/docs/dashboard/domains/introduction), [403 on resend.dev](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain) | Plans, limits, webhooks, test addresses |
| Resend incidents | [isdown.app history](https://isdown.app/status/resend/outage-history) (status aggregator, secondary) | 2026-04-10 outage, about 1.4 hours |
| Postmark | [pricing](https://postmarkapp.com/pricing), [approval](https://postmarkapp.com/support/article/1084-how-does-the-account-approval-process-work), [DMARC monitor](https://dmarc.postmarkapp.com/) | Plans, approval, free DMARC reports |
| Amazon SES | [pricing](https://aws.amazon.com/ses/pricing/), [pricing plans announcement, 2026-07-21](https://aws.amazon.com/about-aws/whats-new/2026/07/amazon-ses-pricing-plans/), [sandbox and production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html), [dev.to summary](https://dev.to/mr_manushukla/amazon-ses-pricing-plans-in-2026-essentials-vs-pro-vs-enterprise-and-when-a-la-carte-still-wins-1ohg) (secondary: says new accounts default to Essentials and existing accounts keep à la carte) | Prices, sandbox |
| Other providers | [Mailgun](https://www.mailgun.com/pricing/), [SendGrid](https://www.twilio.com/en-us/sendgrid) | Free tiers |
| React Email, testing | [React Email](https://react.email/docs/introduction), [repo](https://github.com/resend/react-email), [Mailpit](https://mailpit.axllent.org/) | Templates, local capture |
| Deliverability | [Google sender guidelines](https://support.google.com/a/answer/81126), [Microsoft post](https://techcommunity.microsoft.com/blog/outlook/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730) (did not load), [dmarcian](https://dmarcian.com/microsoft-enforces-spf-dkim-dmarc/) and [egressif](https://egressif.io/resources/sender-requirements/microsoft) (secondary), [FTC CAN-SPAM](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business), [Gmail clipping](https://mxtoolbox.com/dmarc/email/email-clipping) (vendor), [link scanners and magic links](https://github.com/orgs/supabase/discussions/41618) (project discussion) | Rules, penalties, pitfalls |
| Vercel | [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [managing cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [Workflows](https://vercel.com/docs/workflows), [Workflows pricing](https://vercel.com/docs/workflows/pricing), [Workflows GA post](https://vercel.com/blog/a-new-programming-model-for-durable-execution), [Queues](https://vercel.com/docs/queues), [Queues pricing](https://vercel.com/docs/queues/pricing), [background jobs guide](https://vercel.com/kb/guide/how-to-run-background-jobs-in-nextjs-on-vercel), [Workflow SDK deploying](https://workflow-sdk.dev/docs/deploying) | Cron, Workflows, Queues |
| Next.js | [after](https://nextjs.org/docs/app/api-reference/functions/after) | Post-response work |
| Job engines | [Inngest pricing](https://www.inngest.com/pricing), [Inngest limits](https://www.inngest.com/docs/usage-limits/inngest), [QStash](https://upstash.com/pricing/qstash), [Trigger.dev](https://trigger.dev/pricing) | Free tiers, run and delay limits |
| Tick sources | [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/), [cron-job.org](https://cron-job.org/en/), [GitHub schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [GitHub billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) | Free tick options |
| Neon | [pricing](https://neon.com/pricing), [plans](https://neon.com/docs/introduction/plans) | Compute-hour limits |
| Stripe | [webhooks](https://docs.stripe.com/webhooks) | Retries, ordering, async guidance |
| Monitoring | [Sentry pricing](https://sentry.io/pricing/), [Healthchecks.io](https://healthchecks.io/pricing/) | Heartbeat options |
| Calendar | [RFC 5546](https://www.rfc-editor.org/rfc/rfc5546.html), [Nodemailer calendar events](https://nodemailer.com/message/calendar-events), [ical-generator](https://github.com/sebbo2002/ical-generator), [ics](https://github.com/adamgibbons/ics), [Google link template (community docs)](https://github.com/InteractionDesignFoundation/add-event-to-calendar-docs/blob/master/services/google.md), [add-to-calendar-button](https://github.com/add2cal/add-to-calendar-button), [Gmail markup registration](https://developers.google.com/workspace/gmail/markup/registering-with-google) | ICS rules, links, licenses |
| SMS | [Twilio US pricing](https://www.twilio.com/en-us/sms/pricing/us), [Twilio A2P 10DLC](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc), [TCPA revocation summary](https://nixonpeabody.com/insights/alerts/2025/04/11/fcc-partially-delays-new-tcpa-consent-revocation-rules) (law-firm, secondary) | Price, registration, consent |
| Notification platforms | [Knock](https://knock.app/pricing), [Novu](https://novu.co/pricing) | Free tiers |

**Not confirmed:** Brevo and SendGrid plans; Microsoft's own enforcement wording; Twilio 10DLC fee amounts and approval time; TCPA quiet hours; commercial-use terms on the free tiers of Inngest, QStash, Sentry, and Healthchecks.io; whether Resend reviews new accounts by hand; Vercel Queues general availability (docs still say Beta); React Email's current version and last release; the `ics` license; how Outlook and Gmail treat each ICS `METHOD`; GitHub Actions per-job minute rounding; Neon's minimum size on paid plans; `pg-boss` runtime needs.

**Agent-directed text in sources, not acted on:** Stripe's webhooks page opens with an agent skills and `stripe agent setup` quickstart, and Vercel's docs pages carry "install_vercel_plugin" front matter and "For AI agents" link lists. I read them as data and ran nothing.
