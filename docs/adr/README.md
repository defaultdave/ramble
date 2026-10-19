# Architecture decision records

One ADR per question in `docs/plan/BUILD-PLAN.md` P2. Each cites the PRD requirements behind it (`docs/product/PRD.md`), weighs at least two options, recommends one, and says what would change the call. Dave decides each; decisions are logged in `docs/plan/DECISIONS.md`.

Research notes behind the researched ADRs are in `research/`.

| ADR | Question | Recommendation | Status |
|---|---|---|---|
| [0001](0001-framework-and-rendering.md) | R1 Framework and rendering | Next.js 16.4.1+ App Router, Server Components by default, Cache Components on; App Router only, `pages/` added later in the Perf Lab branch | Accepted |
| [0002](0002-data-and-holds.md) | R2 Data, availability, and holds | Neon Postgres with Drizzle; row-locked holds with lazy expiry and a database backstop; an append-only money ledger; allocations for every booking-system host at launch | Accepted |
| [0003](0003-payments.md) | R3 Payments | Stripe Connect with separate charges and transfers; weekly release after the session; gift cards not on Stripe; demo on a Stripe sandbox | Accepted |
| [0004](0004-search-and-map.md) | R4 Search, filters, and map | Server-side filtering with the URL as state; no map at launch | Accepted |
| [0005](0005-styling-and-design-system.md) | R5 Styling and design system | CSS Modules with Figma-sourced tokens; React Aria for the date picker and dialog | Accepted |
| [0006](0006-testing-and-quality-gates.md) | R6 Testing and quality gates | Standards stack; per-PR smoke, axe, and Lighthouse budgets; nightly full suite; load test before launch | Accepted |
| [0007](0007-hosting-and-ci.md) | R7 Hosting, CI, and repository | Vercel and GitHub Actions; public repo created at plan freeze | Accepted |
| [0008](0008-seed-content.md) | R8 Seed content | About 60 curated experiences with licensed stock photos, plus a generated 400-experience scale fixture | Accepted |
| [0009](0009-cat-pass-salvage.md) | R9 Cat Pass salvage | Clean build; Cat Pass for reading only | Accepted |
| [0010](0010-agent-workflow.md) | R10 Agent workflow wiring | Global `/senior` and `/review-pr`; `units.yaml` as the record, mirrored to Issues once public; actuals from git, Dave's minutes, and token-audit | Accepted |

## Decided 2026-10-18

**Amended the same day** with the [industry-gap review](research/industry-gap-review.md): caching, SEO, and product surfaces in 0001; jobs, email, security, and data rules in 0002; added checks in 0006; hosting tier, repo, domain, operations, and delivery in 0007. Also 0005 (Code Connect) and 0007 (measurement).

All ten accepted in one sitting (see `docs/plan/DECISIONS.md`). Changes from the recommendations: 0003, the demo runs on the fake gateway with no Stripe account; 0007, the GitHub repo is created now, private; 0010, pushes to unit branches, PRs, and PR reviews become automatic once Dave opts in. R11 and R12 were folded into 0005 and 0002 as PM notes. PRD-33 stays as signed, with gift validity as configuration and the New York gift law risk logged for counsel. The project's stack decisions are in `.claude/standards/stack-decisions.md`.
