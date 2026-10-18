---
title: Ramble build plan (spec for the PM agent)
created: 2026-09-28
owner: Dave (decisions) / ramble-pm (running it)
status: P1 and P2 done (PRD signed off and ten ADRs accepted 2026-10-18); P3 next
---

# Ramble build plan

## What this is

Ramble is a demo marketplace for bookable experiences (classes, tours, tastings, outdoor trips). It exists to prove two things with one build:

1. **The planning method.** Plan a real project end to end with the seven artifacts, freeze a dated estimate, build it, then write up where the plan was wrong.
2. **The agent team.** Show the execution model working: units routed to human-only, human-led, or agent fan-out, with the actuals logged.

**Done means:** the launch scope agreed in the PRD ships, the frozen plan and the delta writeup exist, and the package (deck + filled workbook + delta) is ready to show.

**Scope comes from the PRD,** negotiated with the client the way a real engagement would be. The only fixed demo constraint: no real money moves (payments stay in test mode).

## Sources the PM reads before deciding anything

| What | Where |
|---|---|
| Planning method (layers, seven artifacts, four seams) | vault `Projects/Personal/Playbook/Project Planning Method.md` |
| Playbook roadmap (phases this plan maps onto) | vault `Projects/Personal/Playbook/Roadmap.md` |
| Method deck v4 | https://claude.ai/artifact/LhMEAwGj9Va5hrVPGpzhjW |
| Umbrella project + history | vault `Projects/Personal/Frontend Playbook System - Start Here.md` |
| Desktop wireframes v0, notes per screen, click-through | Figma `Ramble Core Flow Wireframes` https://www.figma.com/design/tGNKJSWGHyx4UVmpnd5LUp |
| Prior art (evidence, never a template) | `~/Workspace/cat-pass-prototype` (public repo, still carries the old client's framing) |

Vault root: `/Users/davidfleming/Library/Mobile Documents/iCloud~md~obsidian/Documents/Dave's Dev Brain/`

## Standing rules

- **Mobile first.** Design at 390 wide first, then expand. CSS uses min-width breakpoints. Desktop v0 frames are the content inventory, not the source of truth.
- **Prior client work is evidence, not a template.** No names, URLs, copy, URL shapes (`/s/country/state/city`), or architecture language lifted from it. Re-decide on merits.
- **The estimate is recorded and dated before any build unit starts. No edits afterward.** Changes go in the delta log, not the plan.
- **Scope discipline.** Every build unit carries a scope manifest. Adjacent ideas go to Suggestions, not code.
- **Dave decides at the gates below.** The PM recommends; it does not approve itself.

## Phases

Each phase has an exit check. The next phase does not start until the check passes and Dave says go.

### P0. Setup ✅ (2026-09-28)
- Repo `~/Workspace/ramble` (fresh, no history from Cat Pass), PM agent, project memory, this spec.
- Desktop wireframes v0 in Figma. Made before the PRD, so treat them as a sketch to revisit, not a requirement.
- **Exit:** `claude --agent ramble-pm` starts, reads memory, reports status.

### P1. Discovery → PRD
> **Changed 2026-10-18 (Dave):** the discovery role play is skipped. The PRD is drafted from the client brief (`docs/product/discovery/sealed/client-brief.md`) instead of transcripts, and steps 1 and 4 (sessions, reveal, discovery delta) are dropped. See `DECISIONS.md`.

Treat Ramble as a client engagement: a company that wants a brand-new e-commerce site. Nothing technical is decided until the business needs are written down.

1. **Discovery sessions.** Dave interviews the `ramble-client` agent, which answers from a sealed brief (see `docs/product/discovery/README.md`). A stakeholder interview covering the business (what they sell, revenue model, merchant of record or pass-through, why now, what exists today), users on both sides (guests, and how hosts or ops get inventory in), competitors, goals and success metrics, launch scope, constraints (budget, timeline, team, markets, compliance: PCI, WCAG 2.1 AA, privacy), SEO needs, and non-functional targets. Transcript and notes go in `docs/product/discovery/`.
2. **Market scan.** Competitor teardown (booking-flow patterns, fees, cancellation norms) by parallel research agents. This is business research, and it feeds the PRD rather than an ADR.
3. **PRD** in `docs/product/PRD.md`, drafted by the PM **from the client brief** (from the transcripts only, before 2026-10-18): problem, users and jobs to be done, goals with measurable success metrics, non-goals, requirements by funnel section (must / should / later), non-functional requirements, constraints, assumptions, risks, open questions. Every requirement gets an ID (`PRD-##`).

4. **Reveal.** After sign-off, and only then, the PM compares the PRD with the sealed brief and writes `docs/product/discovery/discovery-delta.md`: what discovery found, what it missed, and which misses would have changed the build.

**Exit:** Dave signs off the PRD as "the client." (The discovery delta was dropped on 2026-10-18.) ✅ Signed off 2026-10-18.

### P2. Research → ADRs
One ADR per question in `docs/adr/NNNN-slug.md`: context, the PRD requirements that drive it (`PRD-##`), options (at least two), recommendation, what would change the call. An ADR that can't cite a PRD requirement is either missing a requirement or answering a question nobody asked. Research runs as parallel Sonnet agents; contested calls get a Council pass. P2 and P3 can run in parallel once the PRD is signed.

| # | Question | Starting point, not a decision |
|---|---|---|
| R1 | Framework and rendering (driven by SEO, performance, and team needs in the PRD) | Next.js App Router, RSC by default, `"use client"` as a justified exception (seam 1) |
| R2 | Data and mock backend: catalog, availability, **slot holds with timers**, orders | Server-only DAL, schema-validated at the boundary (seam 2). Storage options: SQLite + Drizzle, hosted Postgres, in-memory. Holds need real server state. |
| R3 | Payments | Stripe test mode (Payment Element + Express Checkout) vs a fake gateway. Idempotent submit either way. |
| R4 | Search and map | Server filtering over seed data, URL as state. Map: MapLibre/Leaflet vs static image vs Mapbox. |
| R5 | Styling and design system | Tokens shared between Figma variables and code, component primitives, Storybook, Code Connect. Presentation logic isolated in hooks, with a "when not to" rule (seam 3). |
| R6 | Testing and quality gates | Unit, component, e2e, axe, Lighthouse budgets in CI. Which run per PR. |
| R7 | Hosting and CI | Vercel + GitHub Actions. Public or private repo. |
| R8 | Seed content | Around 40 to 60 experiences across 8 categories and a few neighborhoods. Images: licensed or generated. Generic copy only. |
| R9 | Cat Pass salvage | Lift specific code after a strip pass, or build clean. A clean build is the stronger evidence for the plan. |
| R10 | Agent workflow wiring | Which pipeline runs units (global `/senior` + `/review-pr`, or the vig squad), where units are tracked (GitHub Issues + Project board vs `units.yaml` only), how actuals are captured (PR timestamps, `token-audit`). |

**Exit:** every ADR has a recommendation and Dave's decision recorded in `docs/plan/DECISIONS.md`. ✅ Met 2026-10-18.

### P3. Design, mobile first
In the same Figma file:
1. Page **Core flow (mobile)**: 01 to 06 at 390 wide. Must include the filter drawer, the booking bar that replaces the sticky widget, and checkout on a phone.
2. Page **States**: loading skeletons, zero results, error with retry, empty cart, hold expired, slot sold out mid-checkout, card declined, network failure after submit.
3. Revise the desktop page as the expansion of mobile.
4. Tokens and primitives in Figma (variables, then Header, Card, Chip, Button, Input, Order summary), matched to R5.

**Exit:** Dave signs off the mobile flow and the states page.

### P4. Plan: the seven artifacts
Written into `docs/plan/`. Where a workbook template does not exist yet, the Ramble artifact becomes the draft template (see Open decisions).

| # | Artifact | File |
|---|---|---|
| 1 | Design doc (Google format, goals and non-goals, the four seams). Traces back to PRD IDs. | `01-design-doc.md` |
| 2 | Work breakdown: section → slice → task | `02-work-breakdown.md` |
| 3 | Complexity 1–3 and uncertainty 1–3 per unit, spike flag | in `units.yaml` |
| 4 | Dependency graph → critical path → parallel branches | `units.yaml` + a script that computes the path |
| 5 | Execution model: human-only / human-led / agent fan-out, routed by uncertainty | in `units.yaml` + `05-execution-model.md` |
| 6 | Estimate: three-point on the critical path, reference-class cross-check, ranges only | `06-estimate.md` |
| 7 | Resourcing options: 1 eng / 1 + fan-out / 2 + fan-out, what binds each | `07-resourcing.md` |

Reference class for #6: Dave's prior checkout epic (about 65 PRs, 13 sections, 3 months, 1 engineer with worktree-parallel agents). Details in the vault, not in this repo.

`units.yaml` entry shape:

```yaml
- id: U-001
  title: Walking skeleton (routes, layout shell, deploy)
  section: platform
  complexity: 2
  uncertainty: 1
  spike: false
  depends_on: []
  execution: human-led
  estimate_days: { o: 1, m: 2, p: 4 }
  actual_days: null
  status: todo
```

**Exit:** the plan is committed with a date tag (`plan-frozen-YYYY-MM-DD`). From here, the plan files are read-only.

### P5. Build
- Walking skeleton first: every route renders, deploys, and has a passing e2e smoke test.
- Then units in dependency order. Agent fan-out units go through the pipeline chosen in R10; human-only units are Dave's.
- Each unit closes with actual days, and a note in `delta-log.md` when it is off by more than 25%.

**Exit:** the funnel works end to end on a phone and on desktop, or the build is deliberately stopped with the reason written down.

### P6. Delta and package
- `delta-log.md` rolled up into a writeup: where the estimate was off, by how much, why.
- Method updated from the delta (workbook v2).
- Package: deck + filled Ramble workbook + delta.

**Exit:** the "planned it, built it, here is where I was wrong" story is ready to tell.

## Gates (Dave decides)

1. PRD sign-off in P1 (Dave as the client).
2. Each ADR in P2.
3. Mobile flow and states sign-off in P3.
4. Plan freeze in P4.
5. Repo creation, issues, merges to `main`, and deploys: the PM prints the command; Dave runs it. Pushes to unit branches, opening PRs, and starting PR reviews need Dave's approval on each action until he opts in to auto mode; then the pipeline does them (ADR 0010, changed 2026-10-18).
6. Any change to phase order or scope.

## Open decisions for Dave

1. **Workbook order.** The roadmap puts the workbook templates before planning Ramble. Recommendation: plan Ramble now and extract the templates from its filled artifacts, since a template drawn from a real example is better than one drawn from nothing.
2. ~~**Timing of the early research.**~~ Closed: the market scan ran in the background, and discovery waited until Dave was free.
3. **Method update.** The planning method starts at the design doc because at the prior client the product already existed. Greenfield work needs a Layer 0 (discovery + PRD) ahead of it. Fold this into the deck and workbook.
