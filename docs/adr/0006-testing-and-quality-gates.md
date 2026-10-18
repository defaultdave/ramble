# ADR 0006: Testing and quality gates

- **Status:** Accepted 2026-10-18 (Dave), as recommended.
- **Date:** 2026-10-18
- **Question:** R6 in `docs/plan/BUILD-PLAN.md`
- **Depends on:** ADR 0002 (data store, for the hold tests), ADR 0007 (preview deploys)
- **Settles stack decisions:** TEST-2, TEST-5, TEST-16

## Context

The house standards already fix most of the testing approach (section 8): Vitest for unit and component tests, Testing Library and user-event, Playwright end to end against a production build, axe in component tests and one end-to-end test, one test per behaviour. What remains is which A rules to settle, which checks run on every pull request, and how the PRD's numeric targets get checked. Agents will write most tests, so suite size is a review item (TEST-13 to TEST-17).

## Driving requirements

| ID | Why it matters here |
|---|---|
| PRD-16, PRD-17, PRD-21, PRD-22 | Holds, hold limits, sold-out mid-checkout, no double charge: concurrency behaviour that a unit test cannot prove |
| PRD-68 | Core Web Vitals "good" at p75 on mobile; lab check before launch, field check after |
| PRD-69 | WCAG 2.2 AA: automated checks plus a manual keyboard and screen-reader pass of checkout |
| PRD-70 | Spike load: 12,500 visitors in 3 hours with checkout still completing |
| PRD-71 | 99.9% availability, measured by a test booking |
| PRD-25, PRD-28, PRD-44 | Emails within 5 minutes |

## Options

**A. Standards stack with per-PR gates and scheduled heavy checks.**
- Every pull request: format check, lint, typecheck, unit and component tests, build, an end-to-end smoke of the booking path against a production build, axe in that smoke, and Lighthouse CI with budgets on three pages (home, browse, experience) on the preview deploy.
- Integration tests for holds run against a real database (a CI service container or a database branch, per ADR 0002), with parallel hold attempts.
- Scheduled, not per PR: the full end-to-end suite nightly; a k6 load test against a preview before launch and before each large release (PRD-70); a synthetic test booking every few minutes in production (PRD-71).
- Manual: keyboard and screen-reader pass of checkout at the P3 and pre-launch gates (PRD-69, A11Y-13).

**B. Lighter per-PR gates.** Only static checks and unit tests per PR; everything else nightly.
- Faster PRs, but regressions in checkout and performance land on `main` before anyone sees them, and agent fan-out produces many PRs a day.

**C. Heavier per-PR gates.** Everything in A per PR, plus visual regression screenshots and the full end-to-end suite on every PR.
- Catches more, but slow and flaky PR checks stall a fan-out pipeline, and visual baselines churn while P3 design is still settling.

## Recommendation

**A.** Settle the A rules as:

| Rule | This project |
|---|---|
| TEST-2 | Vitest (new repo) |
| TEST-5 | MSW for network mocking, so unhandled requests fail and the same handlers serve the browser in development |
| TEST-16 | Mutation check by hand on agent-written tests (break one line, see what fails), as the default says |

Lighthouse budgets match PRD-68 in the mobile lab profile (LCP 2.5 s, CLS 0.1, Total Blocking Time 200 ms as the lab stand-in for INP). The PRD-68 field check after launch reads real-user Core Web Vitals through the analytics wrapper (ADR 0007).

## What would change the call

- PR checks take longer than about 10 minutes and block the fan-out: move Lighthouse CI to nightly and keep the smoke test.
- P3 design is signed off and stable: add visual regression for the six primitives in Storybook.
- A Stryker trial shows hand mutation checks miss duplicates: switch TEST-16 to the tool.
