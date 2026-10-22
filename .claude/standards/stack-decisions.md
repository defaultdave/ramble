# Stack Decisions

Ramble's answers to every rule that [`react-nextjs.md`](~/.claude/standards/react-nextjs.md) marks A (adapts per company), from the ADRs Dave accepted on 2026-10-18 (`docs/adr/`). `senior` and `review` read this file; a blank cell means the default in the global template applies.

## Stack

| Item | This project |
|---|---|
| Framework and version | Next.js 16.4.1 or later, App Router (ADR 0001) |
| React version | 19.3 (ADR 0001) |
| Package manager (SET-14, SET-16) | pnpm for the app (Dave, 2026-10-21); Bun stays the runtime for `scripts/` only |
| Node version (`engines`) | Current active LTS, pinned in `engines` at the walking skeleton |
| Hosting and deploy target | Vercel, US East. Demo on Hobby (checkout states no payment is taken); one 30-minute pulse from GitHub Actions once the repo is public; real job on Pro with per-minute cron. Staged production deployments promoted by Dave (ADR 0007) |
| Backend contract (REST, GraphQL, RPC) and who owns it | No separate API. Server Components read the server-only data layer; mutations are Server Actions; Route Handlers only for payment webhooks and scheduled jobs. Ramble owns it (ADR 0001, 0002, 0003) |
| Web only, or web and mobile | Web only, mobile first (PRD Q-08) |
| Analytics, monitoring, and feature-flag vendors (each gets a wrapper, ARCH-8) | First-party `events` table and `web-vitals` reporter (ADR 0007); Vercel Web Analytics and Speed Insights as the hosted summary, guest pages only, never checkout (one wrapper, U-119; DECISIONS 2026-10-22); Sentry for errors, browser script off checkout; Better Stack free for uptime, heartbeats, and the status page; Axiom free for logs; BotID Basic for bot checks, off checkout; Resend for email in the real job (fake adapter and dev mailbox in the demo). No feature-flag vendor: ops switches live in a settings table. PostHog is the named analytics alternative |
| Design system or component library | In-house primitives on native elements; React Aria Components for the date picker, calendar, and dialog only; Storybook for the primitives (ADR 0005) |

## Decisions

| Rule | Decide | Default | This project |
|---|---|---|---|
| SET-1 | Where project files live: outside `app/`, colocated in route folders, or split by feature | Outside `app/`, under `src/` | |
| SET-2 | The feature count past which code is grouped by feature | A handful | |
| SET-6 | `exactOptionalPropertyTypes` on or off | Decide at setup | |
| SET-8 | typescript-eslint set: `recommended`, `strict`, or a type-checked set | `recommended` | `strict-type-checked` (Dave, 2026-10-21) |
| SET-11 | Formatter | Prettier | |
| SET-21 | Unused-code tool | Knip | |
| SET-22 | Route and page-prop types from `next typegen` | On | |
| DATA-4 | Schema library | Zod | Zod (ADR 0002) |
| DATA-10 | Caching model: `cacheComponents: true` with `'use cache'`, or `force-cache` with `revalidate` | Decide before the first cached fetch | `cacheComponents: true` with `'use cache'`, `cacheLife`, and `cacheTag`; publishing revalidates tags (ADR 0001) |
| DATA-13 | Client-side data library | None until components share a browser cache | |
| FORM-6 | Which interactions get optimistic UI | Decide per interaction | |
| FORM-8 | Which requests can be retried, and so carry an idempotency key | Decide per write endpoint | Every order write has a unique idempotency key created before any provider call; every call to the payment provider carries a key derived from Ramble's own record ID (ADR 0002, 0003) |
| STATE-11 | Reducers for state that handlers update together | On | |
| STATE-14 | React Compiler on or off | Decide at setup | Off for now; decide with the first stateful island (Dave, 2026-10-22) |
| TEST-2 | Unit and component test runner | Vitest (Jest stays in a repo that already has it) | Vitest (ADR 0006) |
| TEST-5 | Network mocking: MSW or stubbed `fetch` | Decide at setup | MSW (ADR 0006) |
| TEST-16 | Mutation check on agent-written tests: by hand or with a tool | By hand | By hand (ADR 0006) |
| UI-2 | Styling system: CSS Modules or Tailwind | CSS Modules beside the component | CSS Modules, with Figma-sourced tokens as CSS custom properties (ADR 0005) |
| PERF-6 | Bundle analyzer | Decide before the first dependency review | |
| PERF-7 | Hand memoization | Follows STATE-14: none in new code when the compiler is on | Allowed in new code while the compiler is off (follows STATE-14) |
| SEC-10 | Content Security Policy | Report-only first | Report-only first. Checkout carries no third-party tags, and its script inventory lists the payment scripts and Ramble's first-party web-vitals and events reporter, for PCI SAQ A (ADR 0003, ADR 0007) |

## Departures

Fixed rules this project cannot follow yet, each with the reason and the condition for removing the exception.

| Rule | Reason | Remove when |
|---|---|---|
| | None in the best-case build. The Perf Lab branch will record a Pages Router area here when it is built (ADR 0001). | |
