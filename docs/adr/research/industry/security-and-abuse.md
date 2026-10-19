# Security, abuse, and edge protection

Researched 2026-10-18 for the Ramble industry-gap review.

## Summary

- The ADRs state duties and pick few mechanisms. ADR 0007 says the beacons are "rate limited" with no mechanism or numbers. SEC-10 says "report-only first" with no policy. ADR 0002 says "insert-only" audit with no privilege, tamper, or read-logging design. ADR 0001 names a patch owner with no tooling. Of 23 capabilities below, 1 is covered, 16 are partial, 6 are gaps. Most gaps are S or M effort.
- **Free on Vercel Hobby** (all read 2026-10-18): platform DDoS mitigation and Attack Mode, 3 custom WAF rules including 1 rate-limit rule (1,000,000 allowed requests included), the Bot Protection managed ruleset, BotID Basic, Deployment Protection, Protection Bypass for Automation, firewall alerts. The one Hobby rate-limit rule is the constraint: put both beacons under one path prefix so a single rule covers them (G1).
- **Limits keyed on a person (sign-in link per email, holds, payment attempts) cannot use the WAF.** Its counting keys are IP and JA4 below Enterprise, and a Server Action is a POST to the page URL. Use a Postgres limiter behind a wrapper (free, no new vendor, testable against the real database). Upstash Ratelimit is the swap if hot-path cost demands it (G1).
- **CSP collides with ADR 0001.** Next.js says nonce-based CSP needs dynamic rendering and Partial Prerendering is incompatible with it; the tracking issue (#89754) is still open. Propose two tiers: strict nonce CSP on dynamic route groups (checkout, confirmation, manage-booking, host, ops, admin), report-only with a host allowlist on the cached editorial shell until a hash approach is proven (G3).
- **Staff MFA is not delivered by "email link plus a 2FA plugin".** Better Auth's two-factor plugin gates credential sign-in by default; magic link, passkey, and OAuth skip it. Propose passkeys as the primary method for ops and admin, with step-up for refunds, payout changes, role changes, and exports (G4).
- **Private-repo tooling:** Dependabot (alerts, security updates, version updates) is free. CodeQL, secret scanning, push protection, and dependency review need GitHub Code Security ($30) or Secret Protection ($19) per active committer per month. Free substitutes: gitleaks, OSV-Scanner, `npm audit`. ADR 0007's plan to make the repo public would make CodeQL and secret scanning free, so clean the history first (G7).
- **Secrets and supply chain moved in 2026.** Vercel's April 2026 incident exposed environment variables not marked sensitive (bulletin closed 2026-10-16). The ChainDrop npm worm (2026-08-04) spread through install scripts and stolen tokens. Use Vercel Secret-type variables, a rotation runbook, a release-age delay, no dependency install scripts, SHA-pinned Actions. The package manager is still blank in `stack-decisions.md` (SET-14), and the pnpm settings assume pnpm (G5).
- **Cost of the real-job picks** if all bought: about $155 to $240 a month for 3 active committers (GitHub Secret Protection plus Code Security $147; BotID Deep Analysis $9 to $90; WAF rate limiting under $1). That is 2 to 3 percent of the $8k retainer (C-01). Estimate; excludes Vercel seats, Sentry, and a pen test (not priced).

## Capability table

Effort: S under 1 day, M 1 to 3 days, L over 3 days of build. Unmeasured estimates; the build is agent-led. When: launch-critical = needed before real guests pay (December 1 target) and present in the demo walking skeleton where free; before scale = before full-list newsletter sends and the 150-host target; later = after. Values marked [proposed] are mine, not the client's. Dated links give the page's own "last updated" stamp; "undated" means the page shows none, and the Sources table lists every page. All read 2026-10-18.

### Abuse and edge

| ID | Capability | Why Ramble needs it | Coverage today | Real-job pick | Free demo option and limits | Effort | When |
|---|---|---|---|---|---|---|---|
| S1 | Edge rate limits (beacons, scanner paths, link guessing) | PRD-70; ADR 0007 beacons must be rate limited (SEC-2); PRD-61 and G4 funnel numbers come from the events table, so a flood poisons them and burns Neon compute | ADR 0007: partial (duty, no mechanism or numbers) | Vercel WAF rate-limit rules on Pro: 40 rules, fixed window 10 s to 10 min, keys IP or JA4 ([limits](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting), 2026-08-28); $0.50 per 1M allowed requests in iad1 ([price](https://vercel.com/docs/pricing/regional-pricing/iad1), 2026-09-14); Pro included amount not stated | Hobby: 1 rate-limit rule per project, 3 custom rules total, 1,000,000 allowed requests included ([limits](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting), 2026-08-28). One prefix for both beacons. Rules live in the dashboard; `vercel.json` supports only challenge and deny ([custom rules](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules), 2026-09-10) | S | launch-critical |
| S2 | App-level rate limits (sign-in link per email, reserve, payment attempts, manage-booking, forms) | PRD-17, PRD-26, PRD-35, PRD-37; OWASP asks for per-account limits on emailed links ([cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), undated) | ADR 0002: partial (PRD-17 limits from hold rows; nothing for the rest) | `rate-limit` wrapper (ARCH-8) over a Postgres table with atomic upsert; swap to [Upstash Ratelimit](https://upstash.com/docs/redis/sdks/ratelimit-ts/overview) (undated; MIT, HTTP-based) if hot-path cost requires | Postgres table: $0, uses Neon compute. Upstash Redis Free: 500K commands a month, pay as you go $0.20 per 100K ([pricing](https://upstash.com/pricing/redis), undated; free size and database count conflict across pages, confirm) | M | launch-critical |
| S3 | Bot defense on abuse-prone actions (reserve, sign-in link request, forms) | PRD-16, PRD-17, PRD-22, RK-10; guest checkout eases card testing ([Stripe](https://docs.stripe.com/disputes/prevention/card-testing), undated) | gap (no bot control in ADR 0002, 0003, 0007) | Vercel BotID behind a `bot-check` wrapper: Deep Analysis on reserve and payment attempt, $1 per 1,000 `checkBotId()` calls on Pro; Basic elsewhere ([BotID](https://vercel.com/docs/botid), 2026-06-16). Turnstile adapter as the exit if hosting leaves Vercel | BotID Basic: free on all plans. WAF Bot Protection managed ruleset, challenge mode: all plans ([rulesets](https://vercel.com/docs/vercel-firewall/vercel-waf/managed-rulesets), 2026-09-10). Turnstile: free, unlimited challenges, 20 widgets, 10 hostnames per widget ([plans](https://developers.cloudflare.com/turnstile/plans/), 2026-08-14) | M | launch-critical |
| S4 | Seat-hoarding and card-testing controls | PRD-16, PRD-17, PRD-20, PRD-22, RK-10; OWASP OAT-021 Denial of Inventory ([threat](https://owasp.github.io/www-project-automated-threats-to-web-applications/assets/oats/EN/OAT-021_Denial_of_Inventory), undated) | ADR 0002: partial (limits keyed on a device cookie a bot can discard); ADR 0003: partial (Radar, hold limits by reference) | Layered keys: signed device cookie plus IP plus JA4; PaymentIntent only against an active hold; cap payment attempts per hold; alert on decline-rate spikes; Radar velocity rules where the plan allows | Same free pieces on the fake gateway; add "hold hoarding" and "decline storm" scenarios to the k6 suite. $0 | M | launch-critical |
| S5 | WAF and DDoS posture | PRD-71 (99.9%), PRD-70; industry norm | gap (ADR 0007 does not mention it) | Pro: platform DDoS (L3, L4, L7, free), custom deny rules for scanner paths, challenge on login paths, persistent actions (Pro), firewall alerts to Slack or webhook, an Attack Mode runbook ([DDoS](https://vercel.com/docs/vercel-firewall/ddos-mitigation), 2026-08-11). OWASP CRS is Enterprise only: skip, rely on Zod and Drizzle parameters | Hobby: DDoS mitigation, Attack Mode, 3 custom rules, Bot Protection ruleset, firewall alerts (>100,000 requests in 10 minutes, [observability](https://vercel.com/docs/vercel-firewall/firewall-observability), 2026-09-10) | S | launch-critical |
| S6 | Cost guardrails (denial of wallet) | ADR 0007 risk: "usage-based billing needs a spend cap"; C-01. Bot and crawler traffic not recognised as an attack is billed ([DDoS](https://vercel.com/docs/vercel-firewall/ddos-mitigation), 2026-08-11) | ADR 0007: partial (risk named, no setting) | Spend Management on Pro: alerts at 50, 75, 100 percent, webhook, optional pause of production ([spend](https://vercel.com/docs/spend-management), 2026-09-18). Use webhook and alerts, not auto-pause, on newsletter days. Cap Neon autoscaling | Hobby has included usage, not a bill: Blob stops working at its limit ([Blob](https://vercel.com/docs/vercel-blob/usage-and-pricing), 2026-09-23). Neon Free: 100 CU-hours ([pricing](https://neon.com/pricing), undated) | S | launch-critical |
| S7 | Security headers and CSP rollout (SEC-10) | SEC-10, SEC-6, PRD-72; XSS on host, ops, and editorial rich text | stack-decisions SEC-10 and ADR 0003: partial (report-only first, checkout inventory; no policy, report sink, enforcement date, or answer to the Cache Components conflict) | Two-tier CSP (G3). Headers: CSP, HSTS (Vercel applies it on custom domains, [CDN security](https://vercel.com/docs/cdn-security), 2026-08-13), X-Content-Type-Options, Referrer-Policy, Permissions-Policy, frame-ancestors | `next.config` headers plus `proxy.ts`; [MDN HTTP Observatory](https://developer.mozilla.org/en-US/observatory) for checks (price not stated on the page). $0 | M | launch-critical (report-only), before scale (enforce) |
| S8 | Payment-page script integrity (PCI SAQ A script criterion) | PRD-72; PCI SSC FAQ 1588, effective 2025-04-01 ([FAQ](https://blog.pcisecuritystandards.org/faq-clarifies-new-saq-a-eligibility-criteria-for-e-commerce-merchants), Feb 2025) | ADR 0003: covered (inventory, report-only CSP, no third-party tags); no automated check | Playwright test that lists scripts and frames on checkout and fails on anything outside the inventory; enforce CSP on checkout first; ask Stripe for written confirmation (the FAQ allows reliance on the provider) | Same test, $0. Any bot-check or error script must stay off the checkout route (G2) | S | launch-critical |

### Build, secrets, and supply chain

| ID | Capability | Why Ramble needs it | Coverage today | Real-job pick | Free demo option and limits | Effort | When |
|---|---|---|---|---|---|---|---|
| S9 | Secrets management and rotation | Stripe keys, webhook secret, DB password, auth secret, `CRON_SECRET`; [Vercel April 2026 incident](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident) (updated 2026-10-16) | ADR 0007: partial (env vars, startup validation, `.env.example`; no classification, inventory, or rotation) | Vercel Secret-type variables (write-only after save), "Separate Production Secret Values" policy ([env](https://vercel.com/docs/environment-variables/sensitive-environment-variables), 2026-08-28), rotation runbook ([rotating](https://vercel.com/docs/environment-variables/rotating-secrets), 2026-07-15), Stripe restricted keys, MFA on Vercel, GitHub, Neon, Stripe, registrar | All free on Hobby. Demo keys stay test-mode. Inventory in G5 | S | launch-critical |
| S10 | Secret scanning and push protection | SEC-11; agents commit, and ADR 0010 auto mode relaxes push prompts | gap | GitHub Secret Protection: $19 per active committer per month on private repos ([GitHub](https://github.com/security/advanced-security), undated) | [gitleaks](https://github.com/gitleaks/gitleaks) (MIT) as pre-commit and CI step; maintainer says the tool is feature complete and moving to Betterleaks. Public repos get secret scanning and push protection by default ([GitHub docs](https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security), undated) | S | launch-critical, and before any flip to public |
| S11 | Dependency alerts, update PRs, merge gate | SEC-9, SEC-12; Next.js advisory cadence (ADR 0001) | ADR 0001: partial (SEC-9 blocks merges; no tool named) | Dependabot with grouping and `cooldown`; `npm audit` or [OSV-Scanner](https://github.com/google/osv-scanner) (Apache-2.0) as the CI gate | Dependabot alerts: all plans; security and version updates listed on the Free plan ([pricing](https://github.com/pricing), undated). Version-update cooldown defaults to 3 days ([options](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference), undated) | S | launch-critical |
| S12 | Supply-chain hardening | SEC-12; 2026 npm worms ([ChainDrop](https://securitylabs.datadoghq.com/articles/npm-worm-compromises-popular-npm-packages.md), 2026-08-04) | ADR 0007: partial (Actions `permissions:` minimum); package manager undecided | pnpm settings: `minimumReleaseAge` (default 1 day, 7 days suggested), dependency build scripts blocked by default since v10, `blockExoticSubdeps`, `trustPolicy: no-downgrade` ([pnpm](https://pnpm.io/supply-chain-security), undated); Actions pinned to commit SHA, read-only `GITHUB_TOKEN` ([GitHub](https://docs.github.com/en/actions/reference/security/secure-use), undated); CODEOWNERS on `.github/`, `.claude/`, `.vscode/` | [Socket](https://socket.dev/pricing) Free (undated): 1 dev seat, unlimited private repos, 1,000 scans a month, 14-day retention. The rest is config, $0 | S | launch-critical |
| S13 | Static analysis (SAST) | SEC-1: every Server Action is a public endpoint | gap | CodeQL via GitHub Code Security: $30 per active committer per month on private repos ([GitHub](https://github.com/security/advanced-security), undated; [CodeQL](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning), undated) | Free if the repo is public. Private: lint rules from the standards; Semgrep CE is a candidate but its license terms were not verified (docs page returned 404) | S | before scale |
| S14 | Branch protection and CI integrity | ADR 0010 auto mode lets the pipeline push and open PRs; SEC-12 | ADR 0007 and 0010: partial (merge is Dave's gate; no server-side rule) | Protect `main`: required checks, PR review, no force push, CODEOWNERS; org-owned repo with required 2FA. Protected branches on private repos need GitHub Pro, Team, or Enterprise ([docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), undated; confirm in repo settings) | Dave's manual merge gate (ADR 0010). Server-side protection is free only on a public repo | S | launch-critical (real job) |
| S15 | Preview deployment protection | ADR 0006 and 0007 run Lighthouse CI and E2E on preview deploys with seeded data and test keys | gap | Standard Protection (all deployments except production domains) plus Protection Bypass for Automation secret in CI; Password Protection $20 a month per project on Pro only if reviewers lack Vercel seats ([protection](https://vercel.com/docs/deployment-protection), 2026-09-15) | Standard Protection and Protection Bypass for Automation: all plans ([bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation), 2026-09-16). Password Protection: not on Hobby | S | launch-critical |

### Identity, audit, and response

| ID | Capability | Why Ramble needs it | Coverage today | Real-job pick | Free demo option and limits | Effort | When |
|---|---|---|---|---|---|---|---|
| S16 | Staff authentication (MFA, sessions, step-up) | PRD-74, PRD-47 payout changes, PRD-51 refunds; NIST AAL2; Vercel's bulletin urges MFA | ADR 0002: partial (email links; MFA listed only as a trigger to change) | Passkeys mandatory for ops and admin, email-link sign-in disabled for those roles, session policy and step-up per G4. Hosted IdP behind a wrapper is the alternative | Better Auth passkey plugin and TOTP, $0 ([passkey](https://www.better-auth.com/docs/plugins/passkey), undated; [2FA](https://www.better-auth.com/docs/plugins/2fa), undated). [WorkOS AuthKit](https://workos.com/pricing) lists the first 1M MAU free (undated; MFA tier not stated) | M | launch-critical |
| S17 | Sign-in link and capability-link hardening | PRD-26 manage link, PRD-33 gift redemption, PRD-37 sign-in | ADR 0001 and 0002: partial (token-gated, noindex; no token spec) | 128-bit random tokens hashed at rest; sign-in links single-use with 5-minute expiry; uniform "if that email exists" reply; per-email and per-IP limits; `Referrer-Policy: no-referrer` on landing pages ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), undated) | Better Auth magic link: 300 s default expiry, single-use, 5 requests per 60 s per route, `storeToken: "hashed"` option ([docs](https://www.better-auth.com/docs/plugins/magic-link), undated). $0 | S | launch-critical |
| S18 | Machine endpoints (webhooks, cron, admin triggers) | ADR 0007 "protected route with a date argument"; Stripe and email webhooks | ADR 0002, 0003, 0007: partial (event table and thin shell; "protected" undefined) | Stripe signature check on the raw body ([Stripe](https://docs.stripe.com/security/guide), undated); `CRON_SECRET` bearer for Vercel cron ([cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs), 2026-08-11); admin triggers need an admin session, step-up, and an audit row | Same, $0. Hobby cron runs once a day within the hour; delivery is best effort and can duplicate (same page) | S | launch-critical |
| S19 | Authorization test matrix | PRD-73 (hosts see only their guests), PRD-74, SEC-1, SEC-3; IDOR guidance ([Next.js](https://nextjs.org/docs/app/guides/data-security), 2026-10-06) | ADR 0002: partial (design says every action checks role and ownership; no verification) | Role by action by resource matrix generated from the role table, run in CI against the real database (extends ADR 0006); Postgres row-level security later if needed | Vitest and Playwright, $0 | M | launch-critical |
| S20 | Audit-log protection (PRD-74) | PRD-74 Must; PRD-51, PRD-47 disputes; PRD-73 | ADR 0002: partial (insert-only table in the same transaction; no role, trigger, tamper, copy, or read-logging design) | Layers in G6: SQL-created runtime role with INSERT and SELECT only, trigger blocking UPDATE, DELETE, TRUNCATE, hash chain, nightly export to a retention-locked bucket, logged PII reads and exports | Trigger, restricted role, hash chain in Neon Free: $0. R2 free tier 10 GB-month ([R2](https://developers.cloudflare.com/r2/pricing/), 2026-10-01); bucket locks block delete and overwrite for a set period ([locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/), 2026-04-30) | M | launch-critical (database layer), before scale (export) |
| S21 | Security monitoring and alerting | PRD-71; forensics after an incident | ADR 0007: partial (Sentry, synthetic booking) | `security_events` table (auth failures, 429s, bot blocks, role changes, refunds by actor) with alert rules; Vercel firewall alerts; 30-day logs need Observability Plus on Pro ([logs](https://vercel.com/docs/logs/runtime), 2026-08-28) | Table plus a daily summary. Runtime logs keep 1 hour on Hobby, 1 day on Pro (same page). [Sentry Developer](https://sentry.io/pricing/): 5k errors, 1 user (undated) | M | before scale |
| S22 | Security testing (DAST, headers, pen test) | NY SHIELD Act asks for regular testing of key controls ([AG](https://ag.ny.gov/resources/organizations/data-breach-reporting/shield-act), 2026) | gap (ADR 0006 has no security checks) | External pen test before scale (cost not researched); ZAP baseline plus Observatory in the nightly run | [ZAP baseline](https://www.zaproxy.org/docs/docker/baseline-scan/) (undated): passive scan via Docker, minutes. Run only against sites Ramble owns. Needs the WAF bypass in G8 | M | before scale |
| S23 | Disclosure, incident response, legal baseline | NY SHIELD Act safeguards and breach notice; C-06, Q-16 (no counsel yet) | ADR 0001: partial (patch owner only) | `security.txt` with `Contact` and `Expires` ([RFC 9116](https://www.rfc-editor.org/rfc/rfc9116), 2022); one-page incident runbook (who rotates, who notifies, who calls counsel); patch response time for Critical advisories inside the retainer | Same, $0 | S | launch-critical |

## Gap sections

### G1. Rate limiting layers (S1, S2, S4)

| Layer | Keys | Cost | Limits and notes |
|---|---|---|---|
| Vercel WAF rule | IP, JA4 (Enterprise adds user agent and headers) | Hobby 1 rule; Pro 40 rules, $0.50 per 1M allowed requests | Counters are per region; blocked traffic is not billed as CDN requests ([pricing](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing), 2026-06-16) |
| `@vercel/firewall` `checkRateLimit` | Any string you pass (email hash, hold ID) | Same rule pricing | Needs a dashboard rule per limit, so Hobby gets one; `timeout` option for failing open or closed ([SDK](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk), 2026-07-23) |
| Postgres table | Anything | Neon compute | One query per check; atomic `INSERT ... ON CONFLICT DO UPDATE`; testable against a real branch (ADR 0006) |
| Upstash Ratelimit | Anything | Free 500K commands a month; $0.20 per 100K | HTTP, no connection pool; allows the request if Redis times out by default ([docs](https://upstash.com/docs/redis/sdks/ratelimit-ts/overview), undated) |
| Better Auth limiter | Per auth route | $0 | Default 100 requests per 10 s; default storage is memory, which suits serverless poorly; set `storage: "database"` ([docs](https://www.better-auth.com/docs/concepts/rate-limit), undated) |

- Edge floods by IP (beacons, scanners, link guessing) go to the WAF. Anything keyed on a person or a hold goes in the app.
- Route Handlers on lambda hosts cannot share memory between requests, and Next.js tells teams to use host rate limits as well as code checks ([Next.js](https://nextjs.org/docs/app/guides/backend-for-frontend), 2026-06-25). An in-memory limiter is therefore useless here.
- A Server Action is a POST to the page URL, so a path-only rule cannot single out one action (inference; the action ID travels in a request header, not verified). Per-action limits live in the app.
- Vercel overwrites `x-forwarded-for` and does not forward client-supplied values ([headers](https://vercel.com/docs/headers/request-headers), 2025-12-13), so IP keys are not client-spoofable. Mobile carriers and offices share IPs (judgment), so IP limits are generous and person-keyed limits strict.
- Beacon cost: under $1 a month at the PRD's 90,000 monthly visitors (assumes 6 beacon requests per visit; estimate).

Proposed limits [proposed], to tune in the k6 run:

| Endpoint | Layer | Key | Limit | On breach |
|---|---|---|---|---|
| Event and vitals beacons, one prefix | WAF rule | IP | 300 per 60 s | 429, no database write |
| Reserve (hold) action | App plus BotID | Signed device cookie, IP | PRD-17 as signed (6 spaces; 3 unpaid holds in 15 minutes, then 15-minute block); plus 20 reserve calls per IP per 10 minutes | Guest message, block |
| Payment attempt | App | Hold ID, IP | 5 attempts per hold; 10 declines per IP per hour | End the hold |
| Sign-in link request | App | Email hash, IP | 3 per email per 15 minutes; 10 per IP per hour | Same reply as success |
| Sign-in link verify | App | IP | 10 per 10 minutes | 429 |
| Staff passkey failures | App | Account | 5 per 15 minutes | Lockout, alert |
| Manage-booking and gift links | WAF plus app | IP, token | 30 per minute per IP; 20 bad tokens per hour per IP | 429 |
| Guest cancel | App | Booking ID | 5 per hour | 429 |
| Group request, contact, opt-in forms | App plus BotID Basic | IP, email | 3 per hour per IP; 1 per host per email per day | 429 |
| CSP report endpoint | WAF rule | IP | 60 per minute | Drop |

One open design call for Dave: PRD-17 lets one device hold 6 spaces, which is a whole 6-seat allocation (the PRD-42 example). A stricter per-session cap would also block a real party of 6. Prefer detect and respond: alert when unpaid holds lapse repeatedly on one session, and step up to a challenge.

### G2. Bot protection and CAPTCHA (S3)

| | BotID Basic | BotID Deep Analysis | Turnstile | WAF Bot Protection ruleset | Nothing |
|---|---|---|---|---|---|
| Price | Free, all plans | $1 per 1,000 `checkBotId()` calls, Pro ([BotID](https://vercel.com/docs/botid), 2026-06-16) | Free, unlimited challenges ([plans](https://developers.cloudflare.com/turnstile/plans/), 2026-08-14) | Free, all plans ([rulesets](https://vercel.com/docs/vercel-firewall/vercel-waf/managed-rulesets), 2026-09-10) | $0 |
| Needs Vercel hosting | Yes | Yes | No ([comparison](https://vercel.com/kb/guide/vercel-botid-vs-cloudflare-turnstile), 2026-09-28) | Yes | n/a |
| Visible challenge | None | None | Managed mode can show a checkbox | JS challenge page, 1-hour session ([concepts](https://vercel.com/docs/vercel-firewall/firewall-concepts), 2026-08-11) | n/a |
| Page script | Same-origin rewrite, Vercel-supplied ([setup](https://vercel.com/docs/botid/get-started), 2026-06-08) | Same, Kasada signals | `challenges.cloudflare.com` in script-src and frame-src ([CSP](https://developers.cloudflare.com/turnstile/reference/content-security-policy/), undated) | None | None |
| Server step | `checkBotId()` | `checkBotId()` per route, client and server levels must match ([advanced](https://vercel.com/docs/botid/advanced-configuration), 2026-07-15) | Siteverify call; token valid 300 s, one use ([start](https://developers.cloudflare.com/turnstile/get-started/), undated) | None | None |
| Test automation | Blocks curl and headless tests in production; local dev always returns not-bot ([local](https://vercel.com/docs/botid/local-development-behavior), 2026-02-26) | Same | Needs a test sitekey (not verified) | Blocked until bypassed | n/a |

Pick: BotID behind a `bot-check` wrapper (ARCH-8), Deep Analysis on reserve and payment attempt, Basic on forms and sign-in link request, Turnstile adapter written only if hosting leaves Vercel (ADR 0007 option B). Add the WAF Bot Protection challenge on `/ops`, `/host`, and sign-in paths.

- **Cost:** Deep Analysis at 5 calls per booking and the forecast's 1,800 bookings a month (B§3) is about $9 a month; ten times the calls is about $90 (estimate; each call bills, so a flood bills too, which is why the WAF limit sits in front).
- **PCI:** mount the BotID client only in the experience and booking route group. The docs show `initBotId()` in `instrumentation-client.ts` for all pages (route scoping not verified), so confirm with the S8 test that checkout loads no BotID script. Otherwise add it to the ADR 0003 inventory.
- **Privacy:** Deep Analysis reads thousands of client signals; the privacy policy (PRD-53, PRD-73) must say so. Counsel question.
- **Demo:** BotID Basic plus the Bot Protection ruleset is free. Deep Analysis cannot be shown on Hobby; plan it only.
- Screened and not weighed: reCAPTCHA and hCaptcha (not researched).

### G3. CSP and headers with Cache Components (S7)

Facts:
- Nonces need dynamic rendering; static pages, ISR, and Partial Prerendering are incompatible; the guide's hash alternative (SRI) is labelled experimental ([guide](https://nextjs.org/docs/app/guides/content-security-policy), 2026-03-20). `cacheComponents` makes PPR the default ([config](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents), 2026-10-15).
- [Issue #89754](https://github.com/vercel/next.js/issues/89754): with `cacheComponents`, reading the nonce in the root layout breaks the build. The reporter's only workaround is hashing static inline scripts in `proxy.ts`. Open, last maintainer comment 2026-08-04, no fix version. SRI is experimental and reported webpack-only; Next.js 16 defaults to Turbopack (per the issue).
- Stripe.js needs `script-src https://js.stripe.com https://*.js.stripe.com`, `frame-src` the same plus `https://hooks.stripe.com`, `connect-src https://api.stripe.com`; Link adds `link.com` ([Stripe](https://docs.stripe.com/security/guide), undated). Stripe's page does not list Express Checkout Element wallet origins; verify in the walking skeleton.

| Option | Cached pages keep caching | XSS strength | Verdict |
|---|---|---|---|
| A. Nonce on every route | No (ADR 0001 caching lost) | Strong | Reject |
| B. Two tiers: nonce plus `strict-dynamic` on dynamic route groups; allowlist or hashes on the cached shell | Yes | Strong where it matters (money, staff UI), weaker on read-only pages | **Pick** |
| C. Host allowlist with `'unsafe-inline'` everywhere | Yes | Weak against XSS; still blocks third-party loads, framing, `base-uri`, `form-action` | Interim for the cached shell |
| D. Experimental SRI | Yes | Strong for external files only | Do not depend on it |

Rollout:
1. **Walking skeleton:** all static headers in `next.config`; `Content-Security-Policy-Report-Only` on every route; rate-limited, deduplicating report endpoint (Sentry's CSP intake was not verified).
2. **Before launch:** enforce on checkout, confirmation, manage-booking, host, ops, admin. Nonce comes from `proxy.ts` scoped by matcher to those route groups; the root layout never reads `headers()`. Skip prefetch requests in the matcher, per the guide.
3. **Cached shell:** try hashes for the static inline scripts. If that fails, stay report-only with the allowlist until #89754 closes.
4. **Header set:** `Strict-Transport-Security` (start without `preload`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (`no-referrer` on token landing pages), `frame-ancestors 'none'`, `Permissions-Policy` with `payment` left allowed so wallet buttons still work (test it; judgment, unsourced).

### G4. Staff and guest authentication (S16, S17)

| Option | Gives staff a real second factor | Cost | Notes |
|---|---|---|---|
| A. Better Auth email link plus 2FA plugin | No by default: 2FA gates `/sign-in/email`, `/sign-in/username`, `/sign-in/phone-number`; magic link, passkey, OAuth skip it unless you add hooks ([2FA](https://www.better-auth.com/docs/plugins/2fa), undated) | $0 | A mailbox alone signs in. Reject for ops and admin |
| B. Passkey primary for ops and admin; TOTP and backup codes as fallback | Yes: phishing-resistant, user verification required | $0 | NIST AAL2 requires offering a phishing-resistant option ([NIST](https://pages.nist.gov/800-63-4/sp800-63b/aal/), undated). **Pick** |
| C. Hosted IdP behind a wrapper (WorkOS AuthKit) | Yes | First 1M MAU free, undated; MFA tier unconfirmed | ADR 0002 already names this as the fallback |
| D. Client's Google or Microsoft tenant via OIDC | Depends on their tenant | $0 plus their licences | Not researched; the client's identity stack is unknown |

Session policy [proposed], from the sources:

| Role | Absolute | Idle | Step-up (passkey within 10 minutes) |
|---|---|---|---|
| Ramble admin, ops | 8 h | 30 min | Refund, cancel, payout change, role change, export |
| Host owner and staff | 7 days sliding | none | Changing payout setup, adding staff |
| Guest (optional account, PRD-37) | 30 days | none | Cancel from the account |

- Sources: NIST AAL2 overall at most 24 h, inactivity at most 1 h, AAL1 overall 30 days ([NIST](https://pages.nist.gov/800-63-4/sp800-63b/aal/), undated); OWASP idle 2 to 5 minutes high value, 15 to 30 low risk, absolute 4 to 8 h for an office app, `__Host-` cookie prefix, new session ID on privilege change, server-side logout invalidation ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), undated).
- Better Auth defaults are 7-day sessions and a 1-day freshness window for sensitive endpoints, and it can list and revoke sessions ([docs](https://www.better-auth.com/docs/concepts/session-management), undated). Tighten for staff and revoke all sessions on offboarding.
- Break-glass: two admins minimum, recovery codes held offline, recovery logged in the audit table.
- Sign-in links: Better Auth stores the token as plain by default; set `hashed`. Mail scanners may open a link before the person does; show a confirm button that POSTs before consuming it (judgment, unsourced).

### G5. Secrets and supply chain (S9 to S12)

Context: Vercel's April 2026 incident began with a compromised third-party AI tool, led to a Vercel employee's account, and exposed non-sensitive environment variables; Vercel says rotate those first, mark secrets sensitive, enable MFA, review the activity log, and set Standard deployment protection ([bulletin](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident), updated 2026-10-16). ChainDrop (2026-08-04) used a `preinstall` script and stolen npm and GitHub tokens, abused Actions workflows, and wrote a VS Code task and a Claude SessionStart hook for persistence; valid SLSA provenance did not mean safe ([Datadog](https://securitylabs.datadoghq.com/articles/npm-worm-compromises-popular-npm-packages.md), 2026-08-05). Earlier 2026 waves ("Mini Shai-Hulud") appear in search summaries only; not read.

Secrets inventory [proposed rotation]:

| Secret | Blast radius | Rotate | Note |
|---|---|---|---|
| Stripe secret key | Refunds, transfers | Yearly, on staff exit, on incident | Restricted key; platform key never in preview |
| Stripe webhook signing secret | Forged events | Yearly | Separate secret per environment |
| Neon owner connection string | Schema, audit table | Yearly | Migrations only; never in runtime env |
| Neon runtime role (SQL-created) | Data read and write | Yearly | INSERT and SELECT on audit table |
| Auth secret | All sessions | On incident | Rotation signs everyone out |
| `CRON_SECRET`, admin trigger secret | Job abuse | Yearly | At least 16 random characters |
| Email provider key | Spoofed mail, bombing | Yearly | Send-only scope |
| Vercel automation bypass secret | Skips protections in previews | On staff exit | Several secrets allowed, one per tool |
| Dump bucket credentials (ADR 0002) | Backup read or delete | Yearly | Write-only to the bucket plus a retention lock |
| GitHub token used by agents | Repo writes | 90 days | Fine-grained, one repo, no workflow scope |

Controls:
- Vercel Secret type, "Separate Production Secret Values" (owner setting), rotate by adding the new value, redeploying, then revoking the old one; old deployments keep old values until redeployed ([rotating](https://vercel.com/docs/environment-variables/rotating-secrets), 2026-07-15). OIDC removes long-lived cloud keys on all plans ([OIDC](https://vercel.com/docs/oidc), 2026-08-04); whether the dump target supports it is not checked.
- Settle SET-14 now. With pnpm: `minimumReleaseAge` (default 1 day), blocked dependency build scripts, `blockExoticSubdeps`, `trustPolicy: no-downgrade`. Dependabot `cooldown` mirrors it (security updates are exempt from cooldown).
- Actions: pin to commit SHA, default token read-only, no `pull_request_target`, environments with required reviewers for deploy secrets ([GitHub](https://docs.github.com/en/actions/reference/security/secure-use), undated).
- Agents: CODEOWNERS on `.github/`, `.claude/`, `.vscode/`; review any change there as code execution.
- Secrets manager vendors (1Password, Doppler, Infisical) were not researched; Vercel's store is enough for one deploy target.

### G6. Audit-log protection (S20)

| Layer | Control | Source or note |
|---|---|---|
| Privilege | Runtime role created by SQL with INSERT and SELECT on `audit_events`. Roles made in the Neon console, CLI, or API join `neon_superuser` and cannot be restricted ([Neon roles](https://neon.com/docs/manage/roles), undated) | ADR 0002 research already chose `REVOKE UPDATE, DELETE`; this adds how to make it bind |
| Trigger | `BEFORE UPDATE OR DELETE OR TRUNCATE` raises an exception | Defense against a bug using the owner role |
| Tamper evidence | `row_hash = sha256(prev_hash, canonical row)`; inserts serialised by an advisory lock (negligible at the forecast's 1,800 bookings a month); nightly job verifies the chain and alerts on a break | OWASP asks for tamper detection ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html), undated) |
| Off-box copy | Nightly signed export to a bucket with a retention lock (R2 bucket locks, $0.015 per GB-month, 10 GB free) | `pgaudit` is not in Neon's extension list ([Neon](https://neon.com/docs/extensions/pg-extensions), undated); Neon's restore window is 6 h on Free, up to 7 days on Launch ([pricing](https://neon.com/pricing), undated), so old rows live only in the export |
| Read logging | Log ops and admin reads of guest PII and every finance export: who, what, when, result | PRD-73 lets ops see all guests; PRD-74 as written covers refunds, cancellations, payout changes only |
| Deletion | Audit rows hold actor and subject IDs, not names or emails, so a PRD-73 anonymisation does not rewrite history | Needs counsel's view on retention (Q-16) |
| Alerts | Alert on chain break, a role change, a refund burst by one actor, an export outside business hours | S21 |

### G7. Private-repo security tooling: what is free

| Capability | Private repo, GitHub Free | Needs | Public repo |
|---|---|---|---|
| Dependabot alerts, dependency graph | Free, all plans ([docs](https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security), undated) | none | Free |
| Dependabot security and version updates | Free (listed on the Free plan, [pricing](https://github.com/pricing), undated) | none | Free |
| Dependency review | No | Code Security | Also needs Code Security |
| CodeQL code scanning | No | Code Security, $30 per active committer per month ([GitHub](https://github.com/security/advanced-security), undated) | Free |
| Secret scanning, push protection | No | Secret Protection, $19 per active committer per month | On by default |
| Protected branches, required checks | Not on a Free personal private repo (confirm) | GitHub Pro, Team, or Enterprise | Free |
| gitleaks, OSV-Scanner, `npm audit`, ZAP baseline | Free, open source | none | Free |
| Socket | Free: 1 dev seat, unlimited private repos, 1,000 scans a month ([Socket](https://socket.dev/pricing), undated) | Team $25 per dev seat, from 5 seats | Same |

Active committer = pushed a commit in the last 90 days, bots ignored ([billing](https://docs.github.com/en/billing/concepts/product-billing/github-advanced-security), undated). If agents commit under Dave's git identity they count as one committer (assumption; check the git config the agents use).

ADR 0007's body still says the repo goes public at plan freeze, while its status line says private. If it flips, CodeQL, secret scanning, and push protection become free, but history is then world-readable. Before a flip: run gitleaks over full history, then review what the tree holds (sealed discovery material, agent memory, local paths).

### G8. Test traffic versus protections (S3, S5, S15, S22)

ADR 0006's k6 run, synthetic test booking (PRD-71), Playwright smoke, Lighthouse CI, and ZAP all look like attackers to the new controls.

| Traffic | What blocks it | Fix |
|---|---|---|
| Playwright, Lighthouse CI on previews | Standard Protection | `x-vercel-protection-bypass` header from a CI secret. The bypass also skips Bot Protection and system mitigations, but not active DDoS blocks ([bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation), 2026-09-16) |
| Synthetic booking in production | BotID, rate limits | WAF bypass rule on a secret header; dedicated test host and experience; exclude from GMV and funnel events |
| k6 load test | IP rate limits, DDoS mitigation | Bypass rule scoped to the runner IPs, ramped load, preview or staging deployment; System Bypass does not override Attack Mode, so turn it off ([Vercel guide](https://vercel.com/kb/guide/how-to-effectively-load-test-your-vercel-application), undated). Run once with the bypass off to prove the limits fire |
| ZAP baseline | WAF challenge and deny | Same bypass; own sites only |

BotID in local development always returns not-bot, so unit and E2E tests of the "bot" branch use the `developmentOptions.bypass` switch ([local](https://vercel.com/docs/botid/local-development-behavior), 2026-02-26).

### G9. Demo cut

| Build free in the demo | Plan only (real job) |
|---|---|
| S1 one WAF rate-limit rule on the beacon prefix plus 2 deny rules; S2 Postgres limiter; S3 BotID Basic plus Bot Protection challenge on login paths | BotID Deep Analysis, WAF rules 2 to 40, persistent actions |
| S4 hold and decline-storm k6 scenarios on the fake gateway | Radar velocity rules |
| S5 firewall alerts to a webhook; Attack Mode runbook | Spend Management (S6), Password Protection |
| S7 header set plus report-only CSP; S8 script-inventory test | Enforced CSP on the cached shell |
| S9 Secret-type variables and runbook; S10 gitleaks; S11 Dependabot; S12 pnpm settings, SHA-pinned Actions | GitHub Secret Protection, Code Security (S13), Socket Team, branch protection on a paid plan (S14) |
| S15 Standard Protection and bypass secret; S16 passkeys for ops and admin; S17, S18, S19 | Hosted IdP, if chosen |
| S20 restricted role, trigger, hash chain, R2 export | Observability Plus logs, pen test (S22), counsel review (S23) |

## Proposed ADR changes

1. **New ADR 0011, "Security baseline" (R13).** One home for decisions that cut across ADRs: the CSP two-tier policy and rollout (G3), headers, bot-check wrapper and BotID pick (G2), rate-limit wrapper and the limit table (G1), supply chain (G5, G7), branch protection, security tests, `security.txt`, incident runbook, NY SHIELD alignment. Records SET-14 (package manager) and fills the SEC-10 row in `stack-decisions.md`.
2. **Amend ADR 0007.** Add an "Edge protection" bullet: WAF rule set (one beacon prefix, scanner deny rules, Bot Protection challenge on login paths), Attack Mode runbook, firewall alerts, Standard Protection on previews with the automation bypass secret, Spend Management on Pro (alerts and webhook, no auto-pause on newsletter days), and the test-traffic bypass (G8). Extend the "Secrets" bullet: Secret type, separate production values, rotation runbook, inventory (G5). Rewrite "protected route with a date argument" as: admin session plus step-up plus audit row, and `CRON_SECRET` for scheduled calls. Fix the repository bullet to say private, and add the pre-publication checklist (G7).
3. **Amend ADR 0002, login section.** Replace the MFA trigger with a decision: passkeys for ops and admin, email-link sign-in disabled for those roles, session table, step-up actions (G4). Add the sign-in link and capability-link spec (S17). Add the rate-limit store (a Postgres table behind a wrapper) and name the device-identity scheme for PRD-17 (signed cookie plus IP plus JA4).
4. **Amend ADR 0002, audit item.** Add the SQL-created runtime role, trigger, hash chain, retention-locked export, read and export logging, and actor and subject IDs instead of names (G6).
5. **Amend ADR 0003.** Add: PaymentIntent created only against an active hold; at most 5 attempts per hold; bot-check scripts stay off the checkout route or join the script inventory; Stripe signature check on the raw body; restricted API keys; ask Stripe for written SAQ A script-criterion confirmation (FAQ 1588).
6. **Amend ADR 0006.** Add per-PR: gitleaks, OSV-Scanner or `npm audit`, script-inventory test on checkout, authorization matrix. Add nightly: ZAP baseline and header grade. Add k6 scenarios: hold hoarding and decline storm; one run with rate-limit bypass off.
7. **Amend ADR 0001, patch ownership.** Name the tooling (Dependabot alerts, Next.js security release feed) and a response time for Critical advisories, inside the retainer.
8. **PRD-74 amendment, needs Dave as client.** Add MFA for ops and admin and read logging of guest PII as Must items. Add a security NFR: pen test before the full-list send, and an incident and breach-notice process (C-06, Q-16).
9. **`stack-decisions.md` (Dave's file).** Fill SEC-10 detail, SET-14 and SET-16, and add rows for rate limiting, bot protection, and staff authentication once ADR 0011 is accepted.

## Sources

All read 2026-10-18. "Page date" is the page's own stamp.

| Source | Supports | Page date |
|---|---|---|
| [Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) | Hobby and Pro limits, keys, windows | 2026-08-28 |
| [Vercel rate limiting SDK](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk) | Custom keys, per-region counters, timeout | 2026-07-23 |
| [Vercel WAF usage and pricing](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing) | Mitigated traffic not billed | 2026-06-16 |
| [Vercel iad1 pricing](https://vercel.com/docs/pricing/regional-pricing/iad1) | $0.50 per 1M rate-limit requests; OWASP $0.80 per 1M | 2026-09-14 |
| [Vercel custom rules](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules) | Actions, persistent actions, `vercel.json` subset | 2026-09-10 |
| [Vercel managed rulesets](https://vercel.com/docs/vercel-firewall/vercel-waf/managed-rulesets) | Bot Protection all plans; OWASP Enterprise | 2026-09-10 |
| [Vercel firewall concepts](https://vercel.com/docs/vercel-firewall/firewall-concepts) | Challenge, bypass, JA4 | 2026-08-11 |
| [Vercel DDoS mitigation](https://vercel.com/docs/vercel-firewall/ddos-mitigation) | All-plan DDoS, billing, Attack Mode | 2026-08-11 |
| [Vercel firewall observability](https://vercel.com/docs/vercel-firewall/firewall-observability) | Alerts on all plans | 2026-09-10 |
| [Vercel BotID](https://vercel.com/docs/botid), [get started](https://vercel.com/docs/botid/get-started), [advanced](https://vercel.com/docs/botid/advanced-configuration), [local](https://vercel.com/docs/botid/local-development-behavior) | Pricing, setup, levels, test behavior | 2026-06-16, 06-08, 07-15, 02-26 |
| [Vercel BotID vs Turnstile](https://vercel.com/kb/guide/vercel-botid-vs-cloudflare-turnstile) | Comparison | 2026-09-28 |
| [Cloudflare Turnstile plans](https://developers.cloudflare.com/turnstile/plans/), [CSP](https://developers.cloudflare.com/turnstile/reference/content-security-policy/), [start](https://developers.cloudflare.com/turnstile/get-started/) | Free tier, CSP domains, token lifetime | 2026-08-14, undated, undated |
| [Vercel Spend Management](https://vercel.com/docs/spend-management) | Alerts, webhook, pause | 2026-09-18 |
| [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection), [bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation) | Standard Protection, Password Protection price, bypass scope | 2026-09-15, 09-16 |
| [Vercel CDN security](https://vercel.com/docs/cdn-security), [request headers](https://vercel.com/docs/headers/request-headers) | HSTS, TLS, `x-forwarded-for` | 2026-08-13, 2025-12-13 |
| [Vercel cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [runtime logs](https://vercel.com/docs/logs/runtime), [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing) | `CRON_SECRET`, log retention, Hobby Blob limits | 2026-08-11, 08-28, 09-23 |
| [Vercel environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables), [rotating](https://vercel.com/docs/environment-variables/rotating-secrets), [OIDC](https://vercel.com/docs/oidc) | Secret type, rotation, OIDC | 2026-08-28, 07-15, 08-04 |
| [Vercel April 2026 incident bulletin](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident) | Incident and advice | Updated 2026-10-16 |
| [Vercel load testing guide](https://vercel.com/kb/guide/how-to-effectively-load-test-your-vercel-application) | Bypass for load tests | Undated |
| [Next.js CSP guide](https://nextjs.org/docs/app/guides/content-security-policy), [issue 89754](https://github.com/vercel/next.js/issues/89754), [cacheComponents](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents) | Nonce vs PPR, open issue | 2026-03-20, last activity 2026-08-04, 2026-10-15 |
| [Next.js data security](https://nextjs.org/docs/app/guides/data-security), [backend for frontend](https://nextjs.org/docs/app/guides/backend-for-frontend) | Server Actions as endpoints, rate limiting note | 2026-10-06, 2026-06-25 |
| [Stripe security guide](https://docs.stripe.com/security/guide), [card testing](https://docs.stripe.com/disputes/prevention/card-testing) | CSP origins, webhook signing, card-testing mitigations | Undated |
| [PCI SSC FAQ 1588](https://blog.pcisecuritystandards.org/faq-clarifies-new-saq-a-eligibility-criteria-for-e-commerce-merchants) | SAQ A script criterion | Feb 2025 |
| [OWASP OAT-021](https://owasp.github.io/www-project-automated-threats-to-web-applications/assets/oats/EN/OAT-021_Denial_of_Inventory), [Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) | Threat, link, session, and log guidance | Undated |
| [NIST 800-63B-4 AAL](https://pages.nist.gov/800-63-4/sp800-63b/aal/), [session](https://pages.nist.gov/800-63-4/sp800-63b/session/) | AAL2 timeouts, phishing-resistant option | Undated |
| [Better Auth 2FA](https://www.better-auth.com/docs/plugins/2fa), [passkey](https://www.better-auth.com/docs/plugins/passkey), [rate limit](https://www.better-auth.com/docs/concepts/rate-limit), [magic link](https://www.better-auth.com/docs/plugins/magic-link), [sessions](https://www.better-auth.com/docs/concepts/session-management) | MFA gap, limiter, token options, session defaults | Undated |
| [Upstash pricing](https://upstash.com/pricing/redis), [Ratelimit](https://upstash.com/docs/redis/sdks/ratelimit-ts/overview), [repo](https://github.com/upstash/ratelimit-js) | Free tier, features, MIT | Undated |
| [GitHub Advanced Security](https://github.com/security/advanced-security), [about](https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security), [pricing](https://github.com/pricing), [code scanning](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning), [billing](https://docs.github.com/en/billing/concepts/product-billing/github-advanced-security) | Private-repo availability, $19 and $30, committer count | Undated |
| [Dependabot options](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference), [Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use), [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) | Cooldown, pinning, branch protection | Undated |
| [pnpm supply-chain security](https://pnpm.io/supply-chain-security), [Socket pricing](https://socket.dev/pricing), [gitleaks](https://github.com/gitleaks/gitleaks), [OSV-Scanner](https://github.com/google/osv-scanner), [ZAP baseline](https://www.zaproxy.org/docs/docker/baseline-scan/), [MDN Observatory](https://developer.mozilla.org/en-US/observatory) | Supply-chain and scanning tools | Undated |
| [Datadog ChainDrop write-up](https://securitylabs.datadoghq.com/articles/npm-worm-compromises-popular-npm-packages.md) | Worm mechanics | 2026-08-04, updated 08-05 |
| [Neon extensions](https://neon.com/docs/extensions/pg-extensions), [roles](https://neon.com/docs/manage/roles), [pricing](https://neon.com/pricing), [IP Allow](https://neon.com/docs/introduction/ip-allow) | No `pgaudit`, restricted roles, restore windows, IP Allow on Scale only | Undated |
| [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/), [bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/) | Free tier, retention locks | 2026-10-01, 2026-04-30 |
| [Sentry pricing](https://sentry.io/pricing/), [WorkOS pricing](https://workos.com/pricing) | Free tiers | Undated |
| [NY AG SHIELD Act](https://ag.ny.gov/resources/organizations/data-breach-reporting/shield-act), [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116) | Safeguards and breach notice, `security.txt` | 2026, 2022 |

### Not confirmed or not researched

- Vercel Pro's included allowance for WAF rate limiting: docs say usage-based; a 2025-05-23 changelog says higher included usage without a number ([changelog](https://vercel.com/changelog/rate-limiting-now-available-on-hobby-with-higher-included-usage-on-pro)).
- Upstash free size (250 MB on one page, 256 MB in a search snippet) and database count (1 or 10).
- Branch protection on a Free personal private repo (search summary of GitHub's page; undated).
- GitHub Pro price, Semgrep CE license terms, Sentry's CSP intake, hosted-IdP MFA tiers, pen test cost.
- Whether BotID's client script can be scoped to some routes; whether a path-only WAF rule can match a Server Action.
- Express Checkout wallet origins for the CSP.
- Domain registrar lock, DNSSEC, CAA records: not researched. Email authentication (PRD-76) belongs to the jobs and email review.
- Undated pages: Neon, Socket, Sentry, WorkOS, Upstash pricing; their numbers may have moved.

**Agent-directed text seen and not acted on:** Vercel docs carry `install_vercel_plugin: npx plugins add vercel/vercel-plugin` in their front matter and "For AI agents" link blocks. Stripe's security and card-testing pages open with a block telling agents to install the Stripe CLI and run `stripe agent setup`. The Upstash Ratelimit page embedded a request to submit feedback to an endpoint. None was run or followed. The ChainDrop write-up describes malware that writes a Claude SessionStart hook; that is a fact about the attack, which is why CODEOWNERS covers `.claude/`.
