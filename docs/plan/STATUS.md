# Status

**Updated:** 2026-10-18
**Phase:** P1 ✅ and P2 ✅ (2026-10-18). P3 Design, mobile first, is next (exit: Dave signs off the mobile flow and the states page). Then P4 Plan.

## Done
- P0: desktop wireframes v0 in Figma (6 screens, notes, click-through); repo, PM agent, project memory, build plan spec; discovery kit.
- 2026-10-08: Ramble also carries the performance examples (see `DECISIONS.md`). Brief lives in the vault at `Projects/Personal/Ramble Perf Lab - Kickoff.md`.
- 2026-10-16: **Market scan** (`docs/product/market/`), small scope: 6 teardowns on booking flow, fees, cancellation; fee and cancellation claims fact-checked.
- 2026-10-18: **Discovery skipped** (Dave); the PRD was drafted from the client brief.
- 2026-10-18: **PRD signed off** (`docs/product/PRD.md`, v1.0): 78 requirements, two independent review rounds. Dave adopted the PM's recommendations for the 14 judgment calls (see the PRD's "Decisions at sign-off" and `DECISIONS.md`).
- 2026-10-18: First commit `9707f47` on `main` (local only).
- 2026-10-18: **P2 done.** All ten ADRs accepted in one sitting, three with changes (see `docs/adr/README.md`); R11 and R12 folded into ADRs 0005 and 0002; project stack decisions filled; global standards baseline moved to Next.js 16.4.1+ and React 19.3 (uncommitted in the vig repo). Earlier the same day: ADRs proposed, all ten (`docs/adr/0001` to `0010`, index and decision list in `docs/adr/README.md`). R1, R2, R3, and the Q-11 spike researched by four Sonnet agents (notes in `docs/adr/research/`); R4 to R10 drafted by the PM from Dave's standards and the PRD. Vendor facts in R5, R7, R8 checked against live pages. Every ADR checked for sections, real PRD IDs, and style.

## In flight
- Nothing.

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
1. **Create the GitHub repo** (ADR 0007, now, private) and push. The PM printed the commands.
2. **Figma connector** needs authorizing before P3 can start.
3. **Workbook order** (open decision 1 in `BUILD-PLAN.md`). Needed before P4.
4. **Method Layer 0** (open decision 3). Not needed until P6.

Legal and vendor questions for the real job, logged, not blocking the demo: Ramble holding host money and the New York gift law (counsel, Q-16); card refund age limit at 12 months (ask Stripe); Stripe's Connect review time.

## Next
P3, mobile first, in the Figma file: the core flow at 390 wide (01 to 06, including the filter drawer, the booking bar, and checkout on a phone), the states page, the desktop revision, then tokens and primitives matched to ADR 0005. Needs the Figma connector authorized. In parallel, Dave creates the GitHub repo.
