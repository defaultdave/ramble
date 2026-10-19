# Status

**Updated:** 2026-10-18
**Phase:** P1 ✅, P2 ✅, and the P3 gate ✅ (all 2026-10-18; the mobile flow and States page are signed off). P3's desktop revision is still open. P4 Plan starts when Dave says go.

## Done
- P0: desktop wireframes v0 in Figma (6 screens, notes, click-through); repo, PM agent, project memory, build plan spec; discovery kit.
- 2026-10-08: Ramble also carries the performance examples (see `DECISIONS.md`). Brief lives in the vault at `Projects/Personal/Ramble Perf Lab - Kickoff.md`.
- 2026-10-16: **Market scan** (`docs/product/market/`), small scope: 6 teardowns on booking flow, fees, cancellation; fee and cancellation claims fact-checked.
- 2026-10-18: **Discovery skipped** (Dave); the PRD was drafted from the client brief.
- 2026-10-18: **PRD signed off** (`docs/product/PRD.md`, v1.0): 78 requirements, two independent review rounds. Dave adopted the PM's recommendations for the 14 judgment calls (see the PRD's "Decisions at sign-off" and `DECISIONS.md`).
- 2026-10-18: First commit `9707f47` on `main` (local only).
- 2026-10-18: **Industry-gap review done** (`docs/adr/research/industry-gap-review.md`, area notes in `docs/adr/research/industry/`): 113 capabilities plus 17 from a critic; 249 free-tier claims checked. Dave adopted Tier A as P4 input, folded into amendments to ADRs 0001, 0002, 0006, 0007. Repo public at plan freeze; demo on Hobby with a no-payment checkout notice; no domain.
- 2026-10-18: **P2 done.** All ten ADRs accepted in one sitting, three with changes (see `docs/adr/README.md`); R11 and R12 folded into ADRs 0005 and 0002; project stack decisions filled; global standards baseline moved to Next.js 16.4.1+ and React 19.3 (uncommitted in the vig repo). Earlier the same day: ADRs proposed, all ten (`docs/adr/0001` to `0010`, index and decision list in `docs/adr/README.md`). R1, R2, R3, and the Q-11 spike researched by four Sonnet agents (notes in `docs/adr/research/`); R4 to R10 drafted by the PM from Dave's standards and the PRD. Vendor facts in R5, R7, R8 checked against live pages. Every ADR checked for sections, real PRD IDs, and style.
- 2026-10-18: **P3 gate met.** Dave, as the client, signed off the mobile flow and the States page against the tone checklist, with a waiver for stand-in brand assets (B3); photography deferred to the seed photos (B4). Logged in `DECISIONS.md`. P3 work in order:
  - **P3 started 2026-10-18** in a session with the Figma tools (Figma account: Full seat, Professional plan, admin).
  - P3 step 1 done: v0 wireframe review, `docs/design/wireframe-review.md`. Dave adopted all four recommendations (logged in `DECISIONS.md`; BUILD-PLAN P3 note added).
  - P3 step 2: Code Connect plan check. Plan and seat pass: Dave's Figma account has a Full seat on a Professional plan ("Davd Fleming's team", admin). Figma help (checked 2026-10-18): Code Connect needs a Full or Dev seat on Professional, Organization, Government, or Enterprise; Professional allows one active library and one active framework, set by a team admin under Admin > Settings > Resources > Code Connect. Publishing a library needs a Full seat with edit access, and a file in Drafts must be moved to a folder first. The file is in a team project (Dave, 2026-10-18), so it can be published as the library. Step 2 done.
  - P3 step 3 done: design system plan (`docs/design/design-system-plan.md`) approved by Dave with direction A "Sunday paper", stand-in brand assets, and Lucide icons (`DECISIONS.md`); naming contract added to ADR 0005. **Library built in Figma 2026-10-18:** 127 variables in five collections (all scoped, all with `var(--…)` code syntax), 12 text styles, 3 elevation styles, Cover, Foundations, Icons and brand (26 Lucide icons, stand-in Logo and Illustration), and 17 components on seven family pages: Button (30 variants), Input, Checkbox, Stepper, Chip, TimeSlot, Badge, Alert, Card, HoldTimer, DatePicker (with an internal day cell), OrderSummary, Header, Footer, BookingBar, FilterDrawer. Each family page has a Light and Dark review frame, checked by screenshot. Audit: no unbound colors, no unstyled text, every component described. Node IDs: `docs/design/figma-library.json`. Not done: publishing the library (Dave, in Figma), Code Connect (P4 spike).
  - P3 step 4 done (2026-10-18): page **Core flow (mobile)** built from library instances only: 01 Home, 02 Browse, 02b filters open, 03 Experience (outdoor kayak, booking bar pinned), 03b guide-only, 04 booking sheet, 04b kids, 04c 21+, 05 Checkout, 05b gift checkout, 06 Confirmation, 06b gift scheduled, 07 Manage booking, 08 Gift redemption. Each screen is labeled with the PRD IDs it covers. Five internal flow parts (InfoRow, SessionRow, Photo, ExpressPay, PaymentElement) sit above the screens. QA: 460 instances, Fraunces and Inter only, no flattened images. Photos are placeholders. The Stepper component was fixed so long hints wrap.
  - P3 step 5 done (2026-10-18): page **States** built, ten 390 x 844 viewport frames from library instances: S1 loading skeletons, S2 zero results with ways forward, S3 error with retry, S4 hold blocked, S5 sold out before the hold, S6 hold expired, S7 sold out mid-checkout, S8 card declined, S9 connection lost after Pay, S10 paid after the hold lapsed (auto refund). Each is labeled with its PRD IDs. No empty cart. New library component: Skeleton (card, horizontal card, text), sized to match the real cards. QA: labels fit, no clipped text, Fraunces and Inter only, 129 instances, no flattened images.
  - P3 step 6 done (2026-10-18): PRD-77 tone checklist, `docs/design/tone-checklist.md` (voice, look, usability; with a PM pre-check). Pre-check: all items pass except B3, which needs a waiver (stand-in wordmark and illustrations), and B4, deferred (photos are placeholders until the seed photos). One copy note: use "From" pricing only when session prices differ. Design notes in three state frames moved into their labels.

## In flight
- **P3 desktop revision:** not started. See Next.

## Open client facts (from the PRD, tracked work, not decisions)
| Q | Needs | Feeds |
|---|---|---|
| Q-11 | Answered by the spike (docs only): FareHarbor, Peek Pro, Mindbody need a partner program; Acuity yes (host on Premium); Square no; Eventbrite read-only. Launch on allocations (ADR 0002). Still needed: Marcus's tally of hosts by system | P4 estimate |
| Q-12 | NYC sales tax map | Launch; tax display is already decided by PRD-78 |
| Q-13 | Sponsor contract: what the $60k needs | Launch scope, gift cards (PRD-34) |
| Q-14 | Launch-day catalog size | P4 |
| Q-16 | Lawyer engaged | Terms, waivers, seller-of-record confirmation |
| Q-19 | Monthly burn | Risk ratings in P4 |
| Q-20 | Newsletter traffic per issue | ADR R7 |
| Q-21 | Investor's GMV bar | G6 |

In this demo, the client facts have no one to ask. Where a fact blocks a decision, the PM proposes a working assumption and logs it as one.

## Blocked on Dave
1. **Board fields.** Repo pushed and board #19 "Ramble" created (checked 2026-10-18), but the second board command (link to the repo and add the fields) has not run: the board has no custom fields and no repo link. Dave runs it, or asks the PM to. The Section field is added at plan freeze.
2. **Publish the Figma library** (Dave, in Figma: Assets panel, Publish). Needed before the P4 Code Connect spike, not before the mobile flow.
3. **Method Layer 0** (open decision 3). Not needed until P6.

Resolved: Figma tools in a new session (2026-10-18, working in the P3 session). Workbook order (2026-10-18: plan Ramble first, extract the templates from its artifacts afterward). The Perf Lab spec conflict: the signed PRD's `PRD-68` is the requirement the detail-page fixes trace to; the router question went to ADR 0001.

Open item from the ADR 0007 measurement amendment (2026-10-18): what New York and US law require for first-party analytics and web-vitals beacons (PRD-73); not researched yet.

Legal and vendor questions for the real job, logged, not blocking the demo: Ramble holding host money and the New York gift law (counsel, Q-16); card refund age limit at 12 months (ask Stripe); Stripe's Connect review time.

## Next
P3 gate met 2026-10-18. The next action is the **desktop revision**, recommended before P4 because the booking panel and two-column checkout are real component work the estimate should count:
- New page at 1440 from the library; keep the v0 desktop page as an archive.
- Library additions: a booking panel (desktop replacement for the booking bar and sheet), desktop Header and Footer variants.
- Full frames for home, browse (card grid, filter side panel), experience (two columns, sticky booking panel), checkout, and confirmation (two columns, order summary at the side). The other screens follow these templates.
- Type uses the Desktop mode (min-width 768 px).
Then P4 (the seven planning artifacts) when Dave says go; read the vault `Projects/Personal/Playbook/Project Planning Method.md` first.
