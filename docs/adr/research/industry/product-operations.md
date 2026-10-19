# Product operations, growth, and compliance tooling

Researched 2026-10-18 for the Ramble industry-gap review.

## Summary

- **Support is the largest hole.** No ADR names a help center or inbox, yet PRD-54 is "do not cut" and RK-04 forecasts 60 to 300 emails a week. At the PRD's own forecast of 1,800 bookings a month, 300 emails a week is about 72 emails per 100 bookings (my arithmetic), which is the baseline for the PRD guardrail. Pick: help articles in the in-app editorial admin (ADR 0005), Help Scout Standard for the inbox (listed at $25 per user a month, so about $50 for two seats). The demo needs no vendor: a contact form writing to a table and an ops queue page.
- **Experimentation should wait for volume.** At the forecast of 1,000 bookings in 60 days, a checkout test has about 909 checkout starts per arm (assuming 55% of starts complete) and can only detect a lift of about 12% relative. Build the assignment function, exposure event, and results view on the first-party `events` table (ADR 0007). Add Flags SDK with GrowthBook (both free to start) after PRD-61 gives real baselines.
- **SEO operations are missing even though rendering is decided.** ADR 0001 covers how pages render. Nothing covers sitemap `lastmod`, indexing by environment, redirect verification for PRD-64, Search Console, or the 60-day crawl watch behind G7. Time-sensitive for the real job: Search Console bulk export does not backfill, so enable it on the current site's property now.
- **PRD-66 is shakier than it looks.** Google's Event markup needs one event per page with its own URL; an experience page that lists many dates is a schedule. FAQ rich results were retired on 2026-05-07, so help pages should not rely on FAQ markup.
- **Privacy: design out the banner, then build the workflow.** A first-party-only script set can launch with no consent banner (the one persistent identifier is the 30-day attribution cookie, gated for EEA, UK, and Swiss visitors). What is missing is a data subject request workflow, a consent record synced to the newsletter platform, a children's data check (PRD-23, New York's Child Data Protection Act), and a vendor register. ADR 0007 left consent as an open item; this closes it.
- **Accessibility statement, feedback path, and legal-document versions are small and absent.** Each is S or M effort and launch-critical. Do not buy an accessibility overlay: the FTC fined one vendor $1 million in 2025 for unsupported compliance claims.
- **PRD-71's 99.9% (43.2 minutes down a month) has no vendor SLA under it.** Vercel's SLA page is titled Enterprise, Neon lists an SLA only on Scale with no percentage, and no numeric Stripe uptime commitment was found. A synthetic booking every 5 minutes is 8,640 runs a month, which is over GitHub's 2,000 free private-repo minutes and Checkly's free 1,000 browser runs. Synthetic bookings must be flagged so they stay out of GMV, funnel, and experiments.
- **Reporting: SQL views plus an in-app page first.** Add a PII-free `reporting` schema, a read-only role, month snapshots, and an `investor` role (PRD-74 lists none). Metabase Cloud Starter ($100 a month) is the upgrade if growth wants ad hoc questions. Real-job add-on cost if all picks are taken: about $214 a month (Help Scout $50, Checkly $64, Metabase $100), roughly 2.7% of the $8k retainer. Demo cost: $0.

## Capability table

Scope: customer support (RK-04, PRD-54), experimentation for checkout conversion, SEO operations (PRD-63 to PRD-66), privacy and consent (PRD-73), accessibility statement and feedback (PRD-69), legal pages (PRD-53), third-party uptime (PRD-71), and reporting for the investor dashboard (PRD-59, PRD-60). ADRs 0001 to 0010 are taken as decided.

Method: pages read only (WebSearch, WebFetch). No account, trial, form, or sign-in was touched. Prices and limits were read on 2026-10-18 unless marked "unconfirmed". Effort is S (under 1 day of build), M (1 to 3 days), L (over 3 days); these are my estimates, not measured. Legal points are research for counsel (Q-16), not legal advice. Row IDs (S1, E1, O1 and so on) are referenced by the gap sections.

| Capability | Why Ramble needs it (PRD-## or industry norm) | Coverage today (ADR number: covered, partial, or gap) | Real-job pick | Free demo option and its limits | Effort (S, M, L) | When |
|---|---|---|---|---|---|---|
| **Support** | | | | | | |
| S1 Shared inbox for guests and hosts | RK-04, PRD-54, B§8.10: 60 to 300 emails a week, no support hire | gap (no ADR names an inbox) | [Help Scout Standard](https://www.helpscout.com/pricing/): $25 per user a month, 2 inboxes included | Contact form writes `support_requests`; ops queue page. Optional: [Help Scout Free](https://docs.helpscout.com/article/1597-free-plan), 1 inbox, up to 5 users, 100 contacts per cycle | M | launch-critical |
| S2 Help center | PRD-54 (never cut): linked from every email; main defense for RK-04 | partial (ADR 0005 editorial admin exists; no help-article type, no email links) | In-app help articles in the editorial admin, Postgres text search (ADR 0004) | Same build, 12 to 15 seeded articles, $0 | M | launch-critical |
| S3 Contact form with spam control | Industry norm; also the intake for DSR and accessibility reports | gap | Server Action, [Turnstile](https://developers.cloudflare.com/turnstile/plans/) (free, unlimited challenges), rate limit (ADR 0007) | Honeypot, minimum-time check, per-IP rate limit. Turnstile needs a Cloudflare account (Dave) | S | launch-critical |
| S4 Booking context in the inbox | RK-04: "is this still on?" answered without a lookup | gap | Order reference in subject and Reply-To; sidebar app later (Help Scout custom app, plan unconfirmed; [Plain customer cards](https://www.plain.com/docs/customer-cards)) | Order reference plus deep link to the ops booking page | S for reference, M for sidebar | before scale |
| S5 Reason tags and support metrics | PRD section 4 guardrail: support emails per 100 bookings | gap | Fixed tag list in the helpdesk; monthly count joined to bookings in reporting | `reason` column on `support_requests`; SQL view | S | launch-critical |
| **Experimentation** | | | | | | |
| E1 Assignment, exposure, results | G2, PRD-61: improve checkout conversion once a baseline exists | partial (ADR 0007: first-party events, no flag vendor, PostHog named) | First-party hash bucketing in `lib/`, exposure event; then [Flags SDK](https://flags-sdk.dev/) + [GrowthBook Starter](https://growthbook.io/pricing) (free, 3 seats) | Same build, $0. One demo test on the experience-page booking bar | M | before scale |
| **Search visibility** | | | | | | |
| O1 Sitemaps for on-demand routes | PRD-64, PRD-65 | partial (ADR 0001 names sitemap; no route list, `lastmod` source, or split) | `sitemap.ts` split by page type with `generateSitemaps`, real `updated_at` | Same, $0 | S | launch-critical |
| O2 Robots and index control by environment | PRD-65; the demo must not be indexed | partial (ADR 0001 sets noindex per surface; no robots policy; staging-domain gap) | `robots.ts`, `X-Robots-Tag: noindex` on private route groups, header on every non-production host | Vercel adds noindex on previews; demo production gets `Disallow: /` and a noindex header | S | launch-critical |
| O3 Structured data and validation | PRD-66 (Should, cut #4) | partial (ADR 0001: JSON-LD in server HTML; no type choice, no validation) | JSON-LD builders typed with `schema-dts`, unit tests, Rich Results Test before launch | Same, paste-in testing | M | before scale (Breadcrumb and Organization at launch) |
| O4 Redirect map verification | PRD-64, RK-08, G7 | partial (ADR 0007 holds the map; nothing tests it) | CI job requests every old URL, asserts one hop to a 200 on a new URL | Same, against a preview with a sample map | M | launch-critical |
| O5 Crawler-view test | PRD-65; ADR 0001 open item (Cache Components) | partial (ADR 0001 notes it; ADR 0006 does not schedule it) | CI fetches key templates with a Googlebot user agent, asserts title, canonical, JSON-LD, body text in HTML | Same | S | launch-critical |
| O6 Search Console and Bing Webmaster Tools | G7 (organic traffic down no more than 10%), PRD-64 | gap | Domain property, sitemaps submitted, bulk export to BigQuery enabled on the current site now | None; demo is noindex. Rich Results Test by pasting code | S | launch-critical |
| O7 Crawl and index watch for the first 60 days | G7, RK-08 | gap | Crawl Stats and Page indexing weekly; [Screaming Frog](https://www.screamingfrog.co.uk/seo-spider/pricing/) crawl (free to 500 URLs); 404 and 5xx from Vercel logs | Same checklist against a preview | S | launch-critical |
| O8 Affiliate link attributes and disclosure | PRD-13, Q-15 ($85k affiliate revenue) | gap | `rel="sponsored"` on affiliate links; disclosure next to the link | Same | S | launch-critical |
| **Privacy and consent** | | | | | | |
| P1 Script inventory and consent decision | PRD-73, PRD-58; ADR 0007 left consent open | partial (ADR 0003 checkout inventory only) | No banner at launch, by design; CMP only on a trigger (see gap G5) | Inventory table plus a CI check that fails on a new third-party host. $0 | S | launch-critical |
| P2 Opt-out signals (GPC) | PRD-73 "where the law requires" | gap | Honor the GPC signal in the attribution code; full state-law program only if counsel says it applies | Same | S | before scale |
| P3 Data subject requests | PRD-73: deletion on request | partial (ADR 0002 anonymizes on request; no intake, verification, log, export, deadline) | Verified request form, `privacy_requests` log with a due date, ops export and anonymize actions | Same, $0 | M | launch-critical |
| P4 Marketing consent record and newsletter sync | PRD-15; CAN-SPAM opt-out within 10 business days | partial (PRD-15 records opt-in; no ADR covers the newsletter platform) | Consent table (time, source, text version) with two-way sync to the newsletter platform | Table only; no platform in the demo | S | launch-critical |
| P5 Children's data check | PRD-23, PRD-73; New York Child Data Protection Act | gap | Counsel opinion; keep to age and guardian contact; no child age in analytics events | Schema rule plus a test | S | launch-critical |
| P6 Vendor register and retention schedule | PRD-73; the privacy policy lists processors | gap | Table of vendors, data held, location, deletion path; retention set with counsel and the CFO | A markdown table in `docs/` | S | launch-critical |
| **Accessibility** | | | | | | |
| A1 Accessibility statement | PRD-69; W3C guidance | gap | `/accessibility` page from the W3C generator, claim only what the audit supports | Same, $0 | S | launch-critical |
| A2 Feedback path with a response time | PRD-69; W3C: contact information is required | gap | Contact-form category routed to a named owner; target of 2 business days (proposed) | Same | S | launch-critical |
| A3 Ongoing accessibility monitoring | PRD-69 | partial (ADR 0006: axe in smoke, manual pass at gates) | Nightly axe over a template and state matrix; yearly outside audit; no overlay | Nightly axe job in CI | M | before scale |
| **Legal pages** | | | | | | |
| L1 Legal documents with versions and acceptance | PRD-53, PRD-24, PRD-52: prove which text a guest or host accepted | partial (PRD-24 records acceptance; no ADR versions the text) | `legal_documents` table in the editorial admin; acceptance rows point at a version; counsel writes the text | Same, placeholder text marked "demo, not legal advice". $0 | M | launch-critical |
| L2 Host agreement acceptance record | PRD-39, PRD-52 | partial | Same table; ops records acceptance at onboarding | Same | S | launch-critical |
| **Third-party uptime** | | | | | | |
| U1 Vendor status watch | PRD-71: the booking path depends on Vercel, Neon, Stripe, the email provider | gap | Team channel subscribed to each vendor's status feed where offered | Ops page listing vendors with status links | S | launch-critical |
| U2 Synthetic booking and alert routing | PRD-71 | partial (ADR 0007: synthetic booking, tool unnamed) | [Checkly Team](https://www.checklyhq.com/pricing/), $64 a month, 12,000 browser runs | Actions cron hourly (720 of 2,000 free private-repo minutes), or a public repo | S | launch-critical |
| U3 Degraded mode and site notice | PRD-20, PRD-71, RK-10 | gap | `site_settings`: banner, pause new bookings, gifts off, toggled by ops | Same, $0 | M | launch-critical (minimal) |
| U4 Availability definition | PRD-71 counts a failed test booking as down, vendor or not | gap | PRD note: report Ramble-caused and vendor-caused downtime separately | n/a | S | launch-critical (decision) |
| **Reporting** | | | | | | |
| R1 Reporting schema and access | PRD-59, PRD-73, PRD-74 | gap (ADR 0007 says SQL views; no schema split, role, or synthetic filter) | `reporting` schema, PII-free views, read-only role, `is_synthetic` excluded | Same | S | launch-critical |
| R2 Monthly investor report and reconciliation | PRD-59, G6, PRD-56 | partial (ADR 0007 views; ADR 0003 daily balance check) | `/ops/reports` month page, CSV and print, immutable month snapshot, nightly tie-out to ledger and Stripe | Same on the fake gateway | M | launch-critical (first report within 30 days, per PRD section 10) |
| R3 Live dashboard and investor access | PRD-60 (Should, cut #7) | partial | Same page plus an `investor` read-only role; [Metabase Cloud Starter](https://www.metabase.com/pricing/) $100 a month if growth wants ad hoc | Metabase open source in Docker on Dave's machine for a recording only | M | before scale |
| **Adjacent (logged, not in scope)** | | | | | | |
| M1 Review moderation and integrity policy | PRD-29, PRD-32; FTC fake-review rule | gap | Written policy, hide and report flow in ops, no suppression of negative reviews | Same | S | before PRD-32 ships |

## Gap sections

### G1 Support inbox, help center, contact form (S1 to S5)

Volume: PRD says about 60 emails a week now, expected 300. Per the PRD forecast (1,800 bookings a month at month 6, which the CFO thinks is high by half), 300 a week is about 1,300 a month, or 72 per 100 bookings.

| Option | Facts (read 2026-10-18) | Fit |
|---|---|---|
| [Help Scout](https://www.helpscout.com/pricing/) | Free: 1 inbox, up to 5 users, 100 contacts per cycle, Docs capped at 10 articles ([free plan doc](https://docs.helpscout.com/article/1597-free-plan)). Standard $25, Plus $45, Pro $75 per user a month; the page shows a monthly or annual toggle but does not label which cycle the numbers are (a [Shopify listing](https://apps.shopify.com/help-scout) shows $30 and $54; unconfirmed). Standard has 2 inboxes and 2 Docs sites. AI Answers add-on $0.75 per resolution | Best fit for a non-technical ops team. Two inboxes (guests, hosts) on Standard |
| [Plain](https://www.plain.com/pricing) | Foundation $45 per seat a month billed annually, no free plan, 7-day trial; help center in Foundation; API, webhooks; customer cards call your API when a thread opens ([docs](https://www.plain.com/docs/customer-cards)). AI resolution costs 100 credits, credit packs start at 1,000 for $10 | Strongest booking-context story (cards). Built for engineering-led teams; Ramble's ops team is not |
| [Zendesk Suite Team](https://www.zendesk.com/pricing/) | $55 per agent a month annual, $69 monthly; 14-day trial; automated resolutions $1.50 committed or $2.00 pay-as-you-go | More than 300 emails a week needs |
| [Chatwoot](https://www.chatwoot.com/pricing) | Hacker free: up to 2 agents, 500 conversations a month, no help center, 30-day retention. Startups $19 per agent | A chat tool first; the free tier drops the help center |
| Shared mailbox | $0 | No assignment, tags, or reports. Fails the PRD guardrail |

**Pick.** Help Scout Standard for two seats, about $50 a month at the listed $25. Help articles live in the editorial admin, not in Help Scout Docs: they must be linked from every email (PRD-54), carry the Ramble brand (PRD-77), and share the site's text search. Help Scout Docs is the fallback if ops wants to edit outside the app; it defaults to its own subdomain ([Docs setup](https://docs.helpscout.com/article/129-help-scout-docs), custom domain details unconfirmed).

Details worth fixing now (all S):
- Every transactional email sets Reply-To to the support address and puts the order reference in the subject, so the inbox can match mail to a booking.
- The manage-booking page shows "on as of" session status (PRD-26, PRD-27). That removes the commonest email, "is this still on?".
- Contact form categories: booking, host, privacy request, accessibility, other. Each maps to a tag and, for privacy and accessibility, a named owner.
- Do not mark up help pages with FAQ schema: Google [retired FAQ rich results](https://developers.google.com/search/updates) effective 2026-05-07 and removed the docs on 2026-06-15.
- AI answer deflection is later. At the listed rates, deflecting 40% of 1,300 emails a month at $0.75 each is about $390 a month (my arithmetic, assumes the 40%). A wrong refund promise from a bot costs more; revisit after tags show which questions repeat.

**Demo.** Help articles, contact form, `support_requests` table, and an ops queue page with status and reason. No vendor, no account. If Dave wants the real tool on screen, Help Scout Free fits a demo (100 contacts per cycle) but needs his account.

**Would change the call:** support volume stays under about 100 contacts a month (Free covers it); ops wants live chat (Chatwoot or Help Scout Beacon); the team gains an engineer (Plain becomes viable).

### G2 Experimentation (E1)

| Option | Facts (read 2026-10-18) | Fit |
|---|---|---|
| None at launch, measure only | $0 | Honest, but leaves G2 without a lever |
| First-party bucketing in `lib/` plus the `events` table | $0; matches ADR 0007 (no flag vendor, no third-party script) | Right first step. No checkout script added, so the PCI inventory (ADR 0003) is untouched |
| [Flags SDK](https://flags-sdk.dev/) with [GrowthBook](https://growthbook.io/pricing) | Flags SDK is free and open source for Next.js and SvelteKit. GrowthBook Starter free: 3 seats, unlimited flags and experiments, 1M CDN requests a month; Pro $40 per seat. Postgres is a [supported data source](https://docs.growthbook.io/app/datasources); a `@flags-sdk/growthbook` adapter exists ([Next.js docs](https://docs.growthbook.io/lib/nextjs)) | Reads results straight from the Postgres events table. Best upgrade path |
| [PostHog](https://posthog.com/docs/experiments/start-here) | First 1M feature flag requests a month free, then $0.0001 each; experiments billed as flag requests | ADR 0007's named alternative. Adds a client script, so consent and the checkout inventory both change |
| Statsig and other paid platforms | Statsig agreed to be acquired by OpenAI in 2025 ([Bloomberg](https://www.bloomberg.com/news/articles/2025-09-02/openai-to-buy-product-testing-startup-statsig-for-1-1-billion)); current pricing and roadmap unconfirmed | Not weighed further |

**Power, by arithmetic.** Per-arm sample is n = 16 p(1-p) / d^2 ([Lehr's rule](https://jhanley.biostat.mcgill.ca/c607/ch07/16_s_sq_over_d_sq.pdf), 80% power, 5% two-sided; [Evan Miller](https://www.evanmiller.org/how-not-to-run-an-ab-test.html) uses the same rule and warns against stopping early). Baselines are my assumptions until PRD-61 reports real ones.

| Test | Baseline (assumed) | Relative lift to detect | Needed per arm |
|---|---|---|---|
| Checkout start to booking | 55% | 10% | about 1,290 |
| Checkout start to booking | 55% | 5% | about 5,200 |
| Experience page to checkout start | 3% | 20% | about 14,200 |
| Experience page to checkout start | 3% | 10% | about 54,200 |

At 1,000 bookings in 60 days and a 55% completion rate there are about 1,820 checkout starts, or 909 per arm. That detects roughly a 12% relative lift. So in the first 60 days, test above checkout (the booking bar, experience-page layout) and in emails, not inside checkout.

**Rules to write down.**
- No tests on price, fee, or tax presentation. PRD-19 promises one total; whether a price test creates consumer-protection exposure was not researched (counsel).
- Fix sample size and end date before starting; no peeking.
- Google's [testing guidance](https://developers.google.com/search/docs/crawling-indexing/website-testing): never show Googlebot different content than users, use 302 redirects and canonical tags for URL variants, end tests promptly, and note that Googlebot generally does not keep cookies.
- Cached pages (ADR 0001) cannot read a cookie at render. The Flags SDK [precompute pattern](https://flags-sdk.dev/concepts/precompute) rewrites to a per-variant path so pages stay static; it multiplies cached variants and requires a secret per environment. Dynamic surfaces (checkout, emails) avoid this.
- A flag store, if needed: Vercel's Global Config (formerly Edge Config) on Hobby gives 1 store, 1 MB, 100,000 reads and 100 writes a month ([limits](https://vercel.com/docs/edge-config/edge-config-limits)). Not needed for the first-party option.

**Demo.** `assignVariant(sessionId, experimentKey)` as a pure function, an `experiment_exposed` event, a results view with a two-proportion test, and a sample-size calculator on the ops page. One live test on the booking bar label. $0.

### G3 Search visibility operations (O1 to O8)

| Item | Options weighed | Pick | Source |
|---|---|---|---|
| Sitemap contents | One file with `new Date()` stamps (the Next.js example); one file per page type with stored `updated_at` | Per type via `generateSitemaps` (experiences, collections, guides, categories, neighborhoods). Search Console then shows submitted vs indexed per type. Omit `priority` and `changefreq`: Google [ignores them](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), and uses `lastmod` only when it is consistently accurate. Limit is 50 MB or 50,000 URLs per file, far above Ramble's size | [Next.js sitemap docs](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap) |
| Sitemap freshness | Trust default caching; tag and test | The Next.js docs say `sitemap.js` is a Route Handler cached by default. Add a test that publishing an experience makes it appear in the sitemap | as above |
| Private surfaces | `Disallow` in robots.txt; `noindex` header | `noindex` via `X-Robots-Tag` on checkout, confirmation, host, ops, and admin, left crawlable. Google says a page blocked by robots.txt never has its noindex seen and can still be listed when linked ([block indexing](https://developers.google.com/search/docs/crawling-indexing/block-indexing)). Use `Disallow` only for `/api/` beacons | as above |
| Non-production hosts | Rely on defaults; add headers | Vercel adds `X-Robots-Tag: noindex` to every preview, but omits it when a custom domain is assigned to a non-production branch ([Vercel KB](https://vercel.com/kb/guide/are-vercel-preview-deployment-indexed-by-search-engines)). Add the header by host. Pick one canonical production host and redirect or noindex the production `vercel.app` name ([Vercel redirects](https://vercel.com/docs/redirects)) | links inline |
| Event structured data | Event per experience page; Product with Offer; one URL per session; skip | Google's [Event docs](https://developers.google.com/search/docs/appearance/structured-data/event): each event needs its own URL with its own markup; pages must focus on a single event, not schedules or lists; `offers.url` must lead to a page where the public can buy that event. An experience page with many dates is a schedule (my reading). [Product docs](https://developers.google.com/search/docs/appearance/structured-data/product-snippet) do not say whether services qualify (unconfirmed). One URL per session would be about 12,000 thin pages (150 hosts x 10 sessions x 8 weeks). Pick: ship BreadcrumbList and Organization at launch; spike Event on one page with the Rich Results Test; treat PRD-66 as unproven | links inline |
| JSON-LD safety and checks | Hand-written strings; typed builders | Typed with [schema-dts](https://nextjs.org/docs/app/guides/json-ld), `<` replaced with its unicode escape (backslash, u003c) per Next.js guidance, unit tests for required fields, [Rich Results Test](https://search.google.com/test/rich-results) and [Schema Markup Validator](https://validator.schema.org/) before launch. The [URL Inspection API](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect) reports only the indexed version, not a live test | links inline |
| Redirect verification | Spot-check; automated | CI requests every old URL and asserts one hop (Google: [chains ideally no more than 3](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes)), 301 or 308, a 200 at the end, no mass redirect to the home page, and keeps them at least a year. Bulk redirects are [Pro and Enterprise only](https://vercel.com/docs/routing/redirects/bulk-redirects) (Pro includes 1,000; maximum 1,000,000 per project), so the demo on Hobby tests config redirects with a sample map | links inline |
| Search Console baseline | Start at launch; start now | Start now. [Bulk export](https://support.google.com/webmasters/answer/12917675) starts on the setup date with no backfill, needs a Google Cloud project with billing enabled, and is subject to storage and query costs above a free level. G7's 20,000-visitor baseline and the PRD-64 URL list both come from the current site's data. This is client work (Q-15 owner area); the real job needs owner access to the existing property | links inline |
| Change of Address | Use; skip | Only if the domain changes ([Google](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes)). Domain plan unconfirmed | links inline |
| Crawl watch | None; weekly checklist | Weeks 1 to 8: [Crawl Stats](https://support.google.com/webmasters/answer/9679690) (host status, response codes), Page indexing, Vercel 404 and 5xx logs, weekly Screaming Frog crawl (free to 500 URLs, £199 a year for more, read 2026-10-18) | links inline |
| Fast indexing | Indexing API; IndexNow | Google's [Indexing API](https://developers.google.com/search/apis/indexing-api/v3/quickstart) is limited to JobPosting and livestream video, so it is out. [IndexNow](https://www.indexnow.org/documentation) pings participating engines (the page names none; Bing support is known to me, not confirmed here). Later | links inline |
| Affiliate links | Plain links; marked | `rel="sponsored"` is [Google's preferred value](https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links). The [FTC](https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers) says a disclosure belongs with the endorsement itself. Both are templates on PRD-13 pages | links inline |

**Not weighed:** Google's Things to do program. Operators are pointed to connectivity partners; direct integration needs approval and a content license ([overview](https://developers.google.com/actions-center/verticals/things-to-do/overview)). Fees and feed specs were not on the page. A growth channel for after launch, not an ADR now.

**Demo.** All of O1 to O5 and O8 are code and CI, $0. The demo production host serves `Disallow: /` and a noindex header on purpose, because the content is fictional.

### G4 Consent and privacy (P1, P2)

**What the research found (all for counsel to confirm):**

| Question | Finding | Source |
|---|---|---|
| New York comprehensive privacy law | None found as of 2026-10-18. The Health Information Privacy Act was vetoed on 2025-12-19; a revised bill (A.10357/S.9269) exists, passage unconfirmed. Check the legislature's pages | [City Bar](https://www.nycbar.org/reports/support-revised-ny-health-information-privacy-act-2026/), [Healthcare Brew](https://www.healthcare-brew.com/stories/2026/01/12/new-york-governor-vetoes-health-data-privacy-bill) |
| California CCPA reach | The AG page lists three triggers: over $25 million revenue, buying, selling, or sharing data of 100,000 or more California residents or households, or half of revenue from selling data. Secondary sources say the revenue figure is inflation-adjusted to $26.625 million. Ramble's revenue is $410k and it sells no data, so likely out of scope | [CA AG](https://oag.ca.gov/privacy/ccpa), [Jackson Lewis](https://www.jacksonlewis.com/insights/navigating-california-consumer-privacy-act-30-essential-faqs-covered-businesses-including-clarifying-regulations-effective-1126) |
| GPC | Under the CCPA a business must treat a user-enabled global privacy control as a valid opt-out of sale or sharing | [CA AG](https://oag.ca.gov/privacy/ccpa), [GPC](https://globalprivacycontrol.org/) |
| New York Child Data Protection Act | In effect 2025-06-20, covers users under 18; applies to services directed at minors or with actual knowledge of a minor; the AG says general-interest sites are outside it. Ramble stores child ages for kids' experiences (PRD-23), so ask counsel | [AG guidance](https://ag.ny.gov/child-data-protection-act-guidance), [Mondaq](https://www.mondaq.com/unitedstates/privacy-protection/1642602/new-yorks-child-data-protection-act-is-now-in-effect-what-you-need-to-do) |
| SHIELD Act | Reasonable safeguards scaled to size; breach notification has no small-business exception. The 30-day deadline claim in one snippet is unconfirmed | [Jackson Lewis](https://www.jacksonlewis.com/insights/new-york-shield-act-faqs) |
| EU and UK visitors | My understanding (not confirmed on a primary page) is that ePrivacy rules reach anything stored or read on the device, first-party or not. France's regulator, whose sheet ties its rules to the ePrivacy Directive, exempts only narrow audience measurement (single publisher, no cross-checking, IP truncated, trackers up to 13 months, anonymous output) | [CNIL](https://www.cnil.fr/en/sheet-ndeg16-use-analytics-your-websites-and-applications) |

**Script and storage inventory (the launch control):**

| Item | Where | Consent needed? |
|---|---|---|
| Events beacon and session ID (ADR 0007) | All pages | US: no opt-in law found. EU or UK: yes if the ID is stored on the device, unless it meets the CNIL-style conditions. Prefer a per-visit ID that is not stored beyond the session |
| `web-vitals` to Ramble's endpoint | All pages | No identifier needed |
| Vercel Speed Insights | Off checkout | Vercel states data points are anonymous and cannot reconstruct a session ([privacy page](https://vercel.com/docs/speed-insights/privacy-policy)) |
| Sentry browser script | Off checkout | Docs differ by SDK version: with `sendDefaultPii` off cookies are not sent, while the newer `dataCollection` option collects scrubbed cookies and the user IP by default; Session Replay has its own masking ([Sentry](https://docs.sentry.io/platforms/javascript/data-management/data-collected/), search snippet). Pin the version, set the option explicitly, keep Replay off. localStorage use unconfirmed |
| Stripe scripts | Checkout | Needed to take payment |
| Turnstile | Contact form only | Bot protection |
| Attribution cookie, 30 days (PRD-58) | All pages | The one persistent identifier. Set only when the visitor is outside EEA, UK, and Switzerland (Vercel's `x-vercel-ip-country` header, [docs](https://vercel.com/docs/headers/request-headers)) or has opted in |

**Pick.** No consent banner at launch. Conditions that reopen it: counsel says a state law applies; any ad or social pixel is added (Priya's channel mix); EU or UK traffic becomes material. If it reopens, weigh:

| CMP | Facts (read 2026-10-18) |
|---|---|
| [CookieYes](https://www.cookieyes.com/pricing/) | Free 5,000 pageviews a month (too low for about 90,000 monthly visitors). Basic $10 for 100,000; Pro $25 for 300,000; GPC support only on Pro and Ultimate |
| [Termly](https://termly.io/pricing/) | Free: 10,000 banner views a month, 1 basic legal policy. Starter $10 (annual) for 50,000; Pro+ $15 for unlimited |
| [vanilla-cookieconsent](https://github.com/orestbida/cookieconsent) | MIT license, free; you build the UI; React support not stated |

**Demo.** The inventory table, a CI check that fails the build when a new third-party host appears in the built HTML or CSP report, and no banner.

### G5 Data subject requests, consent records, and records of vendors (P3 to P6)

- **DSR workflow (P3).** `privacy_requests` rows: type (access, deletion, correction), email, verified-at (email link), received-at, due-at, status, handler. Default deadline 45 days with one 45-day extension, which is the [CCPA clock](https://oag.ca.gov/privacy/ccpa); cheap to adopt even if the law does not apply. Ops actions: export a guest's data as JSON; anonymize (ADR 0002 already keeps payment, tax, and dispute records). Deletion has to reach four places beyond Postgres: the newsletter platform, the helpdesk, Sentry events, and the hourly `pg_dump` copies (ADR 0002). State in the policy that backups age out after a fixed period; decide that period with counsel.
- **Retention (P6).** The records Ramble must keep (payments, tax, disputes, PRD-73) need a table of kind, period, and legal basis. The periods were not researched; counsel and the CFO set them. Make them configuration, the way ADR 0002 treats gift validity.
- **Newsletter consent (P4).** [CAN-SPAM](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business): honor an opt-out within 10 business days; up to $53,088 per violating email; transactional mail is largely exempt. Record time, source, and the exact wording shown (PRD-15). Sync unsubscribes back from the newsletter platform so checkout never re-subscribes someone.
- **Children (P5).** Keep child data to age and guardian contact (PRD-73), never put child age in analytics events, and take counsel's view on the New York Act before launch.
- **Vendor register (P6).** Stripe, Vercel, Neon, the email provider, Sentry, the helpdesk, the newsletter platform, object storage, Turnstile. Columns: data held, region, deletion path, contract link.

### G6 Accessibility statement and feedback (A1 to A3)

- **Statement (A1).** W3C [statement guidance](https://www.w3.org/WAI/planning/statements/): required are a commitment, the standard (WCAG 2.2), and contact information; advisable are known limitations, measures taken, supported browsers, and tested environments. A free generator exists. Write the conformance status the evidence supports; PRD-69 promises automated tests plus one manual checkout pass, which supports "partially conforms", not "fully".
- **Feedback path (A2).** A contact-form category and a monitored address, a named owner, and a response target (2 business days proposed). Link it from the footer and the statement.
- **Monitoring (A3).** ADR 0006 runs axe inside one end-to-end test. Add a nightly job over each template in its states (empty, error, sold out, hold expiring). Budget a yearly outside audit; its price was not researched.
- **Overlays.** The FTC's [accessiBe order](https://www.ftc.gov/news-events/news/press-releases/2025/04/ftc-approves-final-order-requiring-accessibe-pay-1-million) (final 2025-04-22, $1 million) found its claims of making sites WCAG-compliant unsupported. Do not add an overlay or print a compliance badge.
- **Why it matters here.** Seyfarth counted 3,117 federal website-accessibility suits nationally in 2025 and 1,471 federal Title III filings in New York ([Mondaq summary](https://www.mondaq.com/unitedstates/constitutional-administrative-law/1745806/ada-title-iii-federal-lawsuit-filings-fall-slightly-to-8667-in-2025); secondary source).

### G7 Legal documents (L1, L2)

| Option | Facts | Fit |
|---|---|---|
| Counsel-written text in the editorial admin, versioned | Needs a table and two foreign keys | Pick. Ops can publish; acceptance proves the version |
| Static pages in the repo | $0, needs a developer per edit | C-04 says no engineers |
| Hosted policy generator ([Termly](https://termly.io/pricing/): Free 1 basic policy, Starter $10, Pro+ $15 on annual billing; iubenda not priced) | Auto-updated text; embeds a third-party script or iframe | Fine as a first draft for counsel, weak as the text of record |

Design: `legal_documents(id, kind, version, effective_at, body, sha256, published_by)`; guest acceptance at checkout (PRD-24) and host acceptance at onboarding (PRD-39, PRD-52) store the document id; an old-versions page; an email to hosts on material change. Second Circuit law on online contracts turns on reasonably conspicuous notice and unambiguous assent ([Meyer v. Uber summary](https://newmedialaw.proskauer.com/2017/08/30/second-circuit-upholds-ubers-mobile-contracting-process-establishing-template-for-mobile-online-contracting/); secondary source, counsel to confirm). Put the terms link next to the pay button, not in the footer. Demo text is placeholder, labeled "demo, not legal advice".

### G8 Third-party uptime and degraded mode (U1 to U4)

**What backs PRD-71's 99.9%.**

| Dependency | Commitment found | Source |
|---|---|---|
| Vercel | SLA page is titled Enterprise; 99.99% on "commercially reasonable efforts"; credits 10%, 25%, 50% of the month's fees. Plan coverage not named, so Pro is unconfirmed | [Vercel SLA](https://vercel.com/legal/sla) |
| Neon | SLA listed on Scale only; no percentage on the pricing page. Free: 100 CU-hours a project, scale to zero after 5 minutes (cannot be disabled), 6-hour restore window | [Neon pricing](https://neon.com/pricing) |
| Stripe | No numeric uptime figure in the services agreement text that was read (the Service Terms were not read; page partly truncated) | [Stripe SSA](https://stripe.com/legal/ssa) |
| Email provider | Not yet chosen (PRD-76) | n/a |

At 99.9%, 30 days allows 43.2 minutes down. Four serial dependencies each at 99.95% give 99.80%, about 86 minutes (illustrative arithmetic). PRD-71 excludes only disaster recovery, so a vendor outage that fails the test booking counts as down. **Decision for the client (U4):** report Ramble-caused and vendor-caused minutes separately, and say which one the 99.9% applies to.

**Watching vendors (U1).** Vercel's [status page](https://www.vercel-status.com/) offers email, SMS, Slack, webhook, and Atom/RSS. Stripe's status page did not render in the fetch, so its subscription options are unconfirmed. Put each vendor's status link on the ops page and subscribe a team channel where a feed exists.

**Synthetic booking (U2).** Cadence drives cost:

| Option | Facts | Fits a 5-minute cadence (8,640 runs a month)? |
|---|---|---|
| [GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions) in the private repo | 2,000 free minutes a month; shortest cron interval 5 minutes, runs can be delayed or dropped under load ([events doc](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)); each run uses at least a minute | No: about 8,640 minutes. Hourly (720 runs) fits |
| Same in a public repo | Standard runners free; scheduled workflows auto-disable after 60 days without repo activity | Yes, with activity |
| [Checkly](https://www.checklyhq.com/pricing/) | Hobby $0: 1,000 browser runs a month, hard cap (one run about every 43 minutes). Starter $24: 3,000 (every 14 minutes). Team $64: 12,000 | Team only |
| [Better Stack](https://betterstack.com/pricing) | Free: 10 monitors, 1 status page, "free for personal projects"; paid base price not read | Unconfirmed |
| [UptimeRobot](https://uptimerobot.com/pricing/) | Free: 50 monitors at 5 minutes, "hobby and non-profit"; Solo $12 a month annual | Checks a URL, not a booking flow |
| [Upptime](https://upptime.js.org/) | Open source, GitHub Actions every 5 minutes; repo visibility needs unconfirmed | Same Actions limits |

Pick Checkly Team for the real job (it runs Playwright, which ADR 0006 already uses). **Dependencies the synthetic booking creates:** an `is_synthetic` flag on orders and events so GMV (PRD-59), funnel (PRD-61), and experiments exclude it; and a payment path that moves no real money or refunds at once (ADR 0003 does not say which). The commercial-use terms of every free tier above were not stated on the pages; do not use a free tier for the real job without checking.

**Degraded mode (U3).** `site_settings` rows ops can flip: a site banner, "pause new bookings" (global or per experience), gifts off. When Stripe is down, a banner plus pausing new checkout starts protects guests from losing holds mid-payment (ADR 0002 hold design). A public status page is later; the banner and a helpdesk auto-reply cover launch.

**Demo.** An ops "Dependencies" page with vendor links and the three switches, a "simulate payment outage" toggle on the fake gateway, and hourly Actions (720 of 2,000 minutes) or a public repo.

### G9 Reporting and BI (R1 to R3)

| Option | Facts (read 2026-10-18) | Fit |
|---|---|---|
| SQL views + in-app `/ops/reports` | $0; ADR 0007 already makes the numbers SQL views | Pick for PRD-59 and the first PRD-60 |
| [Metabase](https://www.metabase.com/pricing/) | Open source free (AGPL, [repo](https://github.com/metabase/metabase)) but row and column permissions and SSO are paid. Cloud Starter $100 a month ($90 yearly), 5 users, extra $6 each; Pro $575. The Docker Compose example is [not for production](https://www.metabase.com/docs/latest/installation-and-operation/running-metabase-on-docker) | Upgrade when growth wants ad hoc questions |
| [Evidence](https://docs.evidence.dev/) | Core is MIT and builds a static site; Postgres is listed in the current data-source docs, though the Core connector set is unclear. Evidence Studio Team is $2,500 a month ([pricing](https://evidence.dev/pricing)) | Studio is 25 times Metabase Starter |
| Looker Studio | Free tool; Postgres connector terms and viewer sign-in rules unconfirmed | Not weighed |

**Design points (R1, R2):**
- A `reporting` schema of PII-free views (no guest email; repeat rate computed on a hashed verified email inside the view), a read-only database role, and the `is_synthetic` filter. PRD-73 says hosts see only their own guests and ops sees all; an investor sees neither, so add an `investor` role to PRD-74.
- Month snapshots: when a month closes, write the reported numbers to an immutable `report_snapshots` row. Later refunds change live views but not what the investor was told; show restatements separately.
- PRD-59 definitions (GMV before tax and fees, gift timing, repeat rate by verified email) written as SQL with tests, plus a nightly tie-out of totals to the ledger (ADR 0002) and the Stripe balance (ADR 0003).
- **Neon free-tier hazard.** Free allows 100 CU-hours a project, which the page equates to 400 hours of a 0.25 CU compute; scale to zero after 5 minutes cannot be turned off ([plans](https://neon.com/docs/introduction/plans)). A dashboard that polls keeps compute awake. A compute never idle for a 730-hour month at 0.25 CU uses about 183 CU-hours (my arithmetic). IP Allow is Scale only, so an outside BI service cannot be restricted by IP below Scale. Read replicas count toward CU-hours; Free availability unconfirmed. Heavy report queries should not share compute with checkout on the real job.

**Demo.** `/ops/reports` with a month picker, CSV, and a print view over the `reporting` views, seeded from the scale fixture (ADR 0008). Metabase open source in Docker on Dave's machine for a screen recording only (AGPL, not deployed).

### G10 Adjacent, logged only: review integrity (M1)

PRD-29 and PRD-32 collect reviews from verified bookers only. The FTC's [fake-review rule](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials) bans fake reviews, review suppression by unfounded legal threats or intimidation, and undisclosed insider reviews. Google added a review-snippet guideline on 2026-07-24 about fake and undisclosed incentivized reviews ([changelog](https://developers.google.com/search/updates)). Ramble needs a written moderation policy before PRD-32 ships: what ops may hide, a report path for hosts, and a rule that a host cannot pay to remove a review. Logged as a suggestion per scope discipline; not built.

## Proposed ADR changes

| # | Target | Change |
|---|---|---|
| 1 | **New ADR 0011: Support and compliance operations** | Decide: Help Scout Standard for the inbox; help articles as an editorial-admin content type with email links; contact form with spam control; reason tags; DSR workflow and `privacy_requests`; consent records synced to the newsletter platform; accessibility statement and feedback path; vendor register and retention table; children's data rule. Cite PRD-15, 23, 53, 54, 69, 73; RK-04 |
| 2 | **New ADR 0012: Search visibility operations** | Decide: sitemap per page type with stored `updated_at`; robots and `X-Robots-Tag` policy by host and surface; Event markup spike and what PRD-66 ships; redirect verification in CI; crawler-view test; Search Console and Bing setup, bulk export now; first-60-days watch; affiliate link rules. Cite PRD-63 to 66, G7, RK-08 |
| 3 | **Amend ADR 0007** (analytics and monitoring) | Close the consent open item: no banner at launch, attribution cookie gated for EEA, UK, and Switzerland, script inventory with a CI check, CMP triggers. Name the synthetic-booking tool and cadence (Checkly Team, 5 minutes) with the `is_synthetic` flag. Add vendor status watch and the degraded-mode switches. Record the experiment path: first-party assignment now, Flags SDK plus GrowthBook after baselines, PostHog stays the alternative |
| 4 | **Amend ADR 0005** (editorial admin) | Add content types: help article, legal document (versioned, with `sha256`), accessibility statement. State that help articles use the Postgres text search of ADR 0004 |
| 5 | **Amend ADR 0002** (data) | Add: `reporting` schema, read-only role, `is_synthetic` on orders and events, `report_snapshots`, `privacy_requests`, `legal_documents` with acceptance keys, `site_settings`. Note DSR propagation to backups |
| 6 | **Amend ADR 0006** (testing) | Add per-PR or nightly checks: Googlebot-UA fetch of key templates, redirect-map test, JSON-LD unit tests, nightly axe over template states, sitemap-updates-on-publish test |
| 7 | **Amend ADR 0001** (rendering) | Record that FAQ rich results are retired (2026-05-07), Event markup needs one event per page, and the sitemap route is cached by default so it needs a publish test |
| 8 | **Amend `stack-decisions.md`** | Add rows for helpdesk, synthetic monitoring, experiments (first-party until baselines), BI (in-app page; Metabase later), each behind a wrapper (ARCH-8) |
| 9 | **PRD notes for Dave** | PRD-71: say whether vendor outages count against 99.9%. PRD-66: eligibility of multi-date pages is unproven. PRD-74: add an `investor` read-only role. PRD-73: record that EEA, UK, and Swiss visitors are handled by gating the attribution cookie. Q-16 gains: privacy-law applicability, children's data, backup retention, click-through form of terms |

## Sources

All read 2026-10-18 unless noted. Pages marked "search snippet" were seen only in search results.

**Support**
- [Help Scout pricing](https://www.helpscout.com/pricing/); [Help Scout Free plan](https://docs.helpscout.com/article/1597-free-plan); [Help Scout Docs](https://docs.helpscout.com/article/129-help-scout-docs) (search snippet); [Help Scout custom apps](https://developer.helpscout.com/apps/legacy-custom-apps/) (plan requirement not stated); [Shopify listing](https://apps.shopify.com/help-scout) (search snippet, prices differ)
- [Plain pricing](https://www.plain.com/pricing); [Plain customer cards](https://www.plain.com/docs/customer-cards)
- [Zendesk pricing](https://www.zendesk.com/pricing/); [Chatwoot pricing](https://www.chatwoot.com/pricing)
- [Cloudflare Turnstile plans](https://developers.cloudflare.com/turnstile/plans/)

**Experimentation**
- [Flags SDK](https://flags-sdk.dev/); [Flags SDK precompute](https://flags-sdk.dev/concepts/precompute); [Vercel Global Config limits](https://vercel.com/docs/edge-config/edge-config-limits)
- [GrowthBook pricing](https://growthbook.io/pricing); [GrowthBook data sources](https://docs.growthbook.io/app/datasources); [GrowthBook Next.js](https://docs.growthbook.io/lib/nextjs)
- [PostHog experiments](https://posthog.com/docs/experiments/start-here)
- [Bloomberg on Statsig](https://www.bloomberg.com/news/articles/2025-09-02/openai-to-buy-product-testing-startup-statsig-for-1-1-billion) (search snippet)
- [Lehr, Sixteen S-squared over D-squared](https://jhanley.biostat.mcgill.ca/c607/ch07/16_s_sq_over_d_sq.pdf) (search snippet); [Evan Miller](https://www.evanmiller.org/how-not-to-run-an-ab-test.html)
- [Google on website testing](https://developers.google.com/search/docs/crawling-indexing/website-testing)

**Search**
- [Next.js sitemap](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap); [Next.js JSON-LD](https://nextjs.org/docs/app/guides/json-ld)
- [Google sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap); [Google block indexing](https://developers.google.com/search/docs/crawling-indexing/block-indexing); [Google Event](https://developers.google.com/search/docs/appearance/structured-data/event); [Google Product snippet](https://developers.google.com/search/docs/appearance/structured-data/product-snippet); [Google docs changelog](https://developers.google.com/search/updates); [Google site moves](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes); [Google outbound links](https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links); [URL Inspection API](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect); [Indexing API](https://developers.google.com/search/apis/indexing-api/v3/quickstart)
- [Search Console bulk export](https://support.google.com/webmasters/answer/12917675); [bulk export overview](https://support.google.com/webmasters/answer/12918484); [Crawl Stats](https://support.google.com/webmasters/answer/9679690); [Performance report](https://support.google.com/webmasters/answer/7576553)
- [IndexNow](https://www.indexnow.org/documentation); [Things to do](https://developers.google.com/actions-center/verticals/things-to-do/overview); [Screaming Frog](https://www.screamingfrog.co.uk/seo-spider/pricing/); [FTC disclosures](https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers)
- [Vercel redirects](https://vercel.com/docs/redirects); [Vercel bulk redirects](https://vercel.com/docs/routing/redirects/bulk-redirects); [Vercel preview indexing KB](https://vercel.com/kb/guide/are-vercel-preview-deployment-indexed-by-search-engines); [Vercel request headers](https://vercel.com/docs/headers/request-headers)

**Privacy, accessibility, legal**
- [CA AG on the CCPA](https://oag.ca.gov/privacy/ccpa); [Jackson Lewis CCPA FAQs](https://www.jacksonlewis.com/insights/navigating-california-consumer-privacy-act-30-essential-faqs-covered-businesses-including-clarifying-regulations-effective-1126) (search snippet); [GPC](https://globalprivacycontrol.org/)
- [NY City Bar on NYHIPA](https://www.nycbar.org/reports/support-revised-ny-health-information-privacy-act-2026/) (search snippet); [Healthcare Brew](https://www.healthcare-brew.com/stories/2026/01/12/new-york-governor-vetoes-health-data-privacy-bill) (search snippet)
- [NY AG Child Data Protection Act guidance](https://ag.ny.gov/child-data-protection-act-guidance) (search snippet); [Mondaq on the Act](https://www.mondaq.com/unitedstates/privacy-protection/1642602/new-yorks-child-data-protection-act-is-now-in-effect-what-you-need-to-do) (search snippet); [Jackson Lewis on SHIELD](https://www.jacksonlewis.com/insights/new-york-shield-act-faqs) (search snippet)
- [CNIL analytics sheet](https://www.cnil.fr/en/sheet-ndeg16-use-analytics-your-websites-and-applications) (search snippet)
- [CookieYes pricing](https://www.cookieyes.com/pricing/); [Termly pricing](https://termly.io/pricing/); [vanilla-cookieconsent](https://github.com/orestbida/cookieconsent); [Vercel Speed Insights privacy](https://vercel.com/docs/speed-insights/privacy-policy); [Sentry data collected](https://docs.sentry.io/platforms/javascript/data-management/data-collected/) (search snippet)
- [FTC CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business); [FTC fake-review rule](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials)
- [W3C accessibility statements](https://www.w3.org/WAI/planning/statements/); [FTC accessiBe order](https://www.ftc.gov/news-events/news/press-releases/2025/04/ftc-approves-final-order-requiring-accessibe-pay-1-million) (search snippet); [Mondaq on ADA filings](https://www.mondaq.com/unitedstates/constitutional-administrative-law/1745806/ada-title-iii-federal-lawsuit-filings-fall-slightly-to-8667-in-2025) (search snippet)
- [Meyer v. Uber summary](https://newmedialaw.proskauer.com/2017/08/30/second-circuit-upholds-ubers-mobile-contracting-process-establishing-template-for-mobile-online-contracting/) (search snippet)

**Uptime and reporting**
- [Vercel SLA](https://vercel.com/legal/sla); [Vercel status](https://www.vercel-status.com/); [Neon pricing](https://neon.com/pricing); [Neon plans](https://neon.com/docs/introduction/plans); [Stripe services agreement](https://stripe.com/legal/ssa) (partly read)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions); [GitHub schedule event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [Checkly pricing](https://www.checklyhq.com/pricing/); [Better Stack pricing](https://betterstack.com/pricing); [UptimeRobot pricing](https://uptimerobot.com/pricing/); [Upptime](https://upptime.js.org/)
- [Metabase pricing](https://www.metabase.com/pricing/); [Metabase repo](https://github.com/metabase/metabase); [Metabase on Docker](https://www.metabase.com/docs/latest/installation-and-operation/running-metabase-on-docker); [Evidence docs](https://docs.evidence.dev/); [Evidence pricing](https://evidence.dev/pricing)

**Unconfirmed, check before relying**
- Help Scout billing cycle for $25, $45, $75, and which plan includes custom apps. Plain seat caps (inferred). Stripe status-page subscription options and any numeric SLA in its Service Terms. Vercel SLA coverage of Pro. Neon SLA percentage. Commercial-use terms of the Better Stack, UptimeRobot, and Checkly free tiers. Looker Studio Postgres connector terms. Evidence Core Postgres connector. Whether GitHub rounds a run up to a full minute. IndexNow's engine list. The CCPA revenue figure ($25 million on the AG page, $26.625 million in secondary sources). The status of New York's revised health privacy bill and any comprehensive privacy bill. Termly's DSAR form on the Free plan. Whether Metabase Cloud can reach Neon without IP allow-listing. Whether Product markup is allowed for experiences. Statsig's current status.

**Note on docs that addressed coding agents.** Several Vercel docs pages (redirects, bulk redirects, environments, request headers, Global Config limits, Speed Insights privacy) carry a "For AI agents" link block and an `install_vercel_plugin: npx plugins add vercel/vercel-plugin` line in their front matter. Nothing was installed or run. A Termly pricing page showed a promotional code; ignored.
