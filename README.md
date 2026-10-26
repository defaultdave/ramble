```
                                  |>
          *             .        /\           \  |  /       .
                                /  \        -- (   ) --
     .           /\            / .. \          /  |  \
                /  \     /\   /  :   \                    *
       *       /    \   /  \ /   :    \    /\
              /  ..  \ /    \   .:     \  /  \       /\
     /\      / .:  :. \      \ :        \/    \     /  \
    /  \    /.:      :.\      .:         \     \   /    \
 __/    \__/:          :\____.:___________\_____\_/      \___
       . . :            : . .:  . . . . . . . . . . . .
     you are here --> *

  ____      _     __  __  ____   _      _____
 |  _ \    / \   |  \/  || __ ) | |    | ____|
 | |_) |  / _ \  | |\/| ||  _ \ | |    |  _|
 |  _ <  / ___ \ | |  | || |_) || |___ | |___
 |_| \_\/_/   \_\|_|  |_||____/ |_____||_____|
```

# Ramble

**A marketplace for things worth doing: classes, tours, tastings, and outdoor trips.**

Ramble is a demo marketplace for bookable experiences. Guests browse, pick a date, and book a spot; hosts list sessions and get paid. No real money moves: checkout runs on a fake payment gateway.

The site is also an experiment. It is built to prove two things with one project:

1. **A planning method.** Plan a real project end to end, freeze a dated estimate before any code is written, build it, and then publish where the plan was wrong.
2. **A one-person team with AI agents.** One owner makes the decisions; agents research, write code, review, and test. Every unit of work is routed to an agent, to the owner, or to both, and the actual time is logged against the estimate.

## Where the trail is today

| Phase | What happened | When |
|---|---|---|
| P0 Setup | Repo, project manager agent, build plan | Sep 28 |
| P1 Discovery and PRD | 78 requirements, signed off | Oct 18 |
| P2 Research and ADRs | 10 architecture decisions accepted | Oct 18 |
| P3 Design | Mobile-first flow and error states in Figma, signed off | Oct 18 |
| P4 Plan | Seven planning artifacts, frozen at tag `plan-frozen-2026-10-20` | Oct 20 |
| **P5 Build** | **In progress: the merge desk (U-118) comes first** | **From Oct 20** |
| P6 Write-up | Where the plan was wrong, and why | After launch |

The frozen forecast, as ranges rather than single dates:

| Milestone | Likely (P50) | Cautious (P90) |
|---|---|---|
| Prototype: a clickable guest flow on seed data | 2026-12-01 | 2026-12-07 |
| Launch scope from the PRD | 2027-03-08 | 2027-03-29 |

The walking skeleton (U-002) is in place: four route groups with placeholder pages. Real pages replace them unit by unit. Live status, decisions, and the roadmap are in [ramble-pm](https://github.com/defaultdave/ramble-pm).

## The planning method

The plan is seven artifacts, each built on the one before it:

1. [Design doc](docs/plan/01-design-doc.md)
2. [Work breakdown](docs/plan/02-work-breakdown.md): 134 units
3. [Complexity and uncertainty scores](docs/plan/03-scores.md): uncertainty is its own axis, and risky unknowns get a spike before an estimate
4. [Dependency graph and critical path](docs/plan/04-dependency-graph.md)
5. [Execution model](docs/plan/05-execution-model.md): who builds what, and at which review tier
6. [Estimate](docs/plan/06-estimate.md): three-point ranges from a simulation, cross-checked against a reference class
7. [Resourcing](docs/plan/07-resourcing.md): staffing options and the dates each implies

Three rules keep it honest:

- **Estimates are ranges.** Never a single date.
- **Freeze before build.** After the freeze tag, plan files are read-only. Reality goes in the [delta log](https://github.com/defaultdave/ramble-pm/blob/main/delta-log.md).
- **Log actuals as units close.** Anything off by more than 25% gets a one-line reason.

## How the work runs

- **`ramble-pm`**, a project manager agent, runs the plan phase by phase, keeps status and decisions current, and hands work to other agents. Its definition is in [`.claude/agents/ramble-pm.md`](.claude/agents/ramble-pm.md).
- **[`docs/plan/units.yaml`](docs/plan/units.yaml)** is the record of every unit, mirrored to GitHub Issues.
- **Every build unit carries a scope manifest** (in scope, out of scope, reference code). Review checks the diff against it.
- **Tiered auto-merge** ([ADR 0010](docs/adr/0010-agent-workflow.md)): standard units merge to `main` once CI, review, QA, and spec checks pass. Critical units (anything that could oversell a session or double-charge a guest) merge to an `integration` branch that the owner promotes weekly after a nightly smoke test.
- **Decisions stay human.** Requirement sign-off, architecture decisions, the plan freeze, deploys, and changes to the rules themselves are the owner's.

## What it is built with

Decided in the [architecture decision records](docs/adr/README.md):

| Area | Choice |
|---|---|
| Framework | Next.js App Router, Server Components by default, Cache Components on |
| Data | Neon Postgres with Drizzle; row-locked booking holds; an append-only money ledger |
| Payments | A fake gateway for the demo; no real money |
| Search | Server-side filtering with the URL as state; no map at launch |
| Styling | CSS Modules with design tokens from Figma; React Aria for the date picker and dialog |
| Quality | Per-PR smoke, accessibility, and Lighthouse budgets; nightly full suite |
| Hosting | Vercel and GitHub Actions |
| Content | About 60 curated experiences, plus a generated 400-experience fixture for scale |

Mobile first throughout: designs start at 390 px wide, and CSS uses min-width breakpoints.

## Map of the repo

```
docs/
  product/     PRD, client brief, market scan
  adr/         architecture decisions and the research behind them
  design/      wireframe review, design system plan, tone checklist, Figma library ids
  plan/        build plan, the seven artifacts, units.yaml, status, decisions, delta log
scripts/plan/  Bun scripts that compute the plan from units.yaml
.claude/       the PM agent, its skill, and its project memory
```

## Setup

Needs Node 24 (`.nvmrc`) and pnpm 10. Node 25 no longer bundles Corepack, so install it once with `npm install -g corepack` and then run `corepack enable`; it reads the pinned version from `packageManager` in `package.json`.

```
pnpm install
docker compose up -d --wait  # local Postgres 17
cp .env.example .env.local   # APP_URL has a default; the two database URLs do not
pnpm db:migrate
pnpm dev
```

The gates CI runs on every PR (`.github/workflows/ci.yml`), each a script you can run locally: `pnpm format:check`, `lint`, `typecheck`, `test`, `build`, `knip`, and `e2e` (Playwright; run `pnpm exec playwright install chromium` once). Storybook has three local scripts: `pnpm storybook` (dev server), `pnpm storybook:build`, and `pnpm storybook:test` (runs the stories with the a11y gate); its CI job is landing separately. `pnpm smoke` runs the same Playwright smoke of every route against the built app; the route list is `e2e/routes.ts`, one row per route. Environment variables are read and validated in one place, `src/server/env.ts`. Import boundaries between `src/app`, `src/components`, `src/lib`, and `src/server` are enforced by `pnpm lint`; `tests/lint-boundaries.test.ts` fails if a rule is weakened. Secrets, and how to rotate them, are in [`docs/runbooks/secret-rotation.md`](docs/runbooks/secret-rotation.md). Logging, error tracking, and how to raise an alert are in [`docs/runbooks/alerting.md`](docs/runbooks/alerting.md). The two-tier Content Security Policy (enforced with a nonce on dynamic routes, report-only on cached ones), the security header set, and `security.txt` are in [`docs/runbooks/security-headers.md`](docs/runbooks/security-headers.md).

## Database

Postgres on Neon through Drizzle, all under `src/server/db/`. `db` (pooled host, `pg` Pool) is the only handle that opens a transaction; `dbRead` (Neon HTTP) is for single reads and never runs a capacity or balance check. Migrations are committed SQL in `src/server/db/migrations/`: change the schema in `src/server/db/schema/`, run `pnpm db:generate`, commit the result, and never `drizzle-kit push` a shared database. A PR never drops or renames a column the deployed code still reads (expand, then contract in a later PR). `pnpm db:migrate` uses the direct host, `pnpm db:check` checks the history, and `pnpm test:db` runs the `*.db.test.ts` files against the local Postgres, each in its own schema (`createFreshDatabase` in `tests/db/harness.ts`). Previews migrate before the build; production is migrated only by the `db-migrate-production` workflow, run by hand.

Preview branches come from the Neon integration for Vercel, which gives each preview deployment its own `preview/<git branch>` database branch and injects its two URLs; the alternative, a GitHub Actions job using Neon's branch actions, would need a Vercel token to hand the URLs to the deployment and would race it, so only the integration creates branches. A GitHub Actions workflow adds what the integration lacks: the 7-day expiry and deleting the branch when the PR merges or closes.

The integration makes a branch's database and URLs only when a deployment is redeployed, so the first build of a new branch has no `DATABASE_URL_UNPOOLED`. The preview build then skips `db:migrate` with a warning instead of failing; redeploy once and it migrates.

## Running the planning scripts

The scripts need [Bun](https://bun.sh) and have no other dependencies.

```bash
bun scripts/plan/critical-path.ts
```

```bash
bun scripts/plan/forecast.ts --report estimate
```

`critical-path.ts` prints the critical path through the dependency graph. `forecast.ts` simulates the build with review time as a limited resource; `--report resourcing` and `--report schedule` give the staffing options and the dated schedule.

## Design

Wireframes and the component library are in Figma: [Ramble Core Flow Wireframes](https://www.figma.com/design/tGNKJSWGHyx4UVmpnd5LUp).
