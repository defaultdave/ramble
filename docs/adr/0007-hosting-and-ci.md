# ADR 0007: Hosting, CI, and repository

- **Status:** Accepted 2026-10-18 (Dave), with one change: the GitHub repo is created now, private, instead of at plan freeze. The demo runs on Vercel Hobby with scheduled jobs triggered by hand; the real job is planned on Pro.
- **Date:** 2026-10-18
- **Question:** R7 in `docs/plan/BUILD-PLAN.md`
- **Depends on:** ADR 0001 (framework), ADR 0002 (data store and its backups)
- **Settles stack decisions:** hosting and deploy target; analytics and monitoring vendors (each behind a wrapper, ARCH-8)

## Context

The client has no engineers (C-04) and about $8k a month for ongoing work (C-01), so hosting should need no operations staff. Traffic is spiky: a weekly newsletter sends up to about 12,500 visitors in a few hours (PRD-70, Q-20 open). The demo build is non-commercial, uses test-mode payments, and needs preview deploys for agent pull requests. Deploys and repo creation are Dave's gate.

## Driving requirements

| ID | Why it matters here |
|---|---|
| PRD-70 | Spike load without degrading PRD-68 thresholds |
| PRD-71 | 99.9% monthly availability of the booking path |
| PRD-75 | Restore within 24 hours, losing no more than 1 hour of records |
| PRD-27, PRD-33 | Reminders 24 hours before (within an hour) and gift emails within 5 minutes of the delivery time need a scheduler that runs every few minutes |
| PRD-64 | Redirects for every current page with organic traffic |
| PRD-68 | Fast on phones; field data after launch |
| PRD-72 | Card data never touches Ramble's servers (unaffected by hosting, since Stripe-hosted fields carry it) |
| C-01, C-04 | Budget and no in-house engineers |

## Options

**A. Vercel, with GitHub Actions for CI gates.** Preview deploy per pull request, production on merge to `main`, functions in the US East region next to the database (ADR 0002).
- Fit: built by the Next.js team, so framework features work first; scales with spikes without capacity planning; no servers for the client to run.
- Cost: Pro is $20 a month plus $20 per extra developer seat ([pricing](https://vercel.com/pricing), checked 2026-10-18). The free Hobby plan is "for personal, non-commercial use" (same page), so the demo fits it only while it stays a personal portfolio piece.
- Risk: platform lock-in on a few features (image optimization, analytics); usage-based billing needs a spend cap.

**B. Cloudflare Workers through the OpenNext adapter, or Netlify.**
- Fit: cheaper at scale (Cloudflare), global edge.
- Risk: Next.js support comes through an adapter that trails framework releases, so features in ADR 0001 may lag. More moving parts for a client with no engineers.

**C. A container on Fly.io, Render, or AWS running `next start`.**
- Fit: full control, predictable pricing.
- Risk: the client owns scaling, patching, and uptime, which a team with no engineers cannot do. The spike in PRD-70 needs capacity planning.

## Recommendation

**A: Vercel and GitHub Actions.**
- **CI:** GitHub Actions runs the SET-17 gates (format, lint, typecheck, test, build) and the ADR 0006 per-PR checks, with `permissions:` set to the minimum. Preview deploys come from the Vercel GitHub integration.
- **Redirects:** the redirect map for PRD-64 lives in config generated from the migration list; if the list runs to thousands, use the platform's bulk redirects ([docs](https://vercel.com/docs/redirects)).
- **Scheduled jobs:** reminders (PRD-27), gift delivery and expiry (PRD-33), weekly host transfers (ADR 0003), hold cleanup (ADR 0002), and the daily balance reconciliation. Hobby runs cron once a day with up to 59 minutes of imprecision, so the real job needs Pro's per-minute cron (or a queue service behind a wrapper). The demo triggers these jobs from a protected route with a date argument.
- **Region:** functions in US East, next to the database (ADR 0002). Region loss is covered by the independent hourly database dump in ADR 0002, plus a redeploy from `main`.
- **Monitoring** [proposed], each behind a wrapper: Vercel Speed Insights for real-user Core Web Vitals (PRD-68 field check), Sentry for errors, and a scheduled synthetic test booking from GitHub Actions or a monitoring service for PRD-71. The checkout page loads none of these scripts: ADR 0003's PCI scope needs it free of third-party tags.
- **Secrets:** environment variables in Vercel and GitHub, read and validated once at start-up (SET-18, SET-19); `.env.example` committed.
- **Repository** [proposed]: public on GitHub, created when the plan is frozen in P4, so the freeze tag and every unit's pull request are on the record for the package. Creating it is Dave's gate.

## What would change the call

- The demo needs real scheduled jobs (not manual triggers): move the demo to Pro.
- Monthly hosting cost for the real job approaches a meaningful share of the $8k budget: price Cloudflare through OpenNext against the actual traffic.
- A required framework feature is unavailable on Vercel: unlikely, but would reopen B or C.
- Dave wants the repo private until launch: create it private at plan freeze and switch it to public later.
