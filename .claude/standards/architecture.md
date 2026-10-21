# Architecture Standards: Ramble

Ramble's layer rules. This file replaces the global default (`~/.claude/standards/architecture.md`) for this project: `architecture-audit` reads it, and `senior` and `review` treat it as binding alongside `stack-decisions.md`. It restates the design doc's seams 1 to 4 (`docs/plan/01-design-doc.md` sections 4.1 to 4.4) and the ADRs as rules a reviewer can check against a diff. Where this file and the design doc disagree, the design doc wins; flag the conflict instead of picking one.

The rule IDs (ARCH, SET, RSC, DATA, UI, and so on) are from Dave's React and Next.js Standards: the vault note `Projects/Personal/Playbook/React and Next.js Standards.md`, carried into Claude Code as `~/.claude/standards/react-nextjs.md` (same 156 rules; the Claude Code copy has the 16.4.1 baseline). Every rule there applies to Ramble as written, with the A rules settled in `stack-decisions.md`. This file changes only where things live: the service modules of ARCH-2 and ARCH-8 sit in `src/server/` rather than `lib/`, because design doc 4.2 makes the data layer server-only (RSC-5). B10, B12, B14 to B16 add Ramble rules on top.

The principle behind every row is the default's: write code so a unit test can reach every decision in it. Ramble adds two of its own: the data layer is the only door to the database and the outside world, and the money and hold paths follow the design doc's transaction rules exactly.

This file sits under `.claude/`, which the `scope-manifest` check protects. Agents do not edit it; a change is Dave's, logged in `docs/plan/delta-log.md`.

## Layers

All source lives under `src/` (SET-1). Imports use the `@/` alias for `src/`.

| Kind | Lives in | Holds | Never holds |
|---|---|---|---|
| Plain functions | `src/lib/` | Every decision: pricing lines, hold timer state, spaces label, cancellation window, age rule, filter parsing, refund split, error copy (design doc 4.3). Takes `now` as an argument when time matters | React, I/O, `process.env`, a database or SDK import, `Date.now()` |
| Data layer | `src/server/` with `import 'server-only'` | Reads and writes through Drizzle, Zod validation at the boundary, the caller and ownership check, transactions with their outbox, audit, and ledger rows (design doc 4.2) | Markup, a decision worth a unit test (call `src/lib/`) |
| Ports and adapters | `src/server/ports/<port>/` (`payments`, `availability`, `email`, `storage`, `rate-limit`, `clock`): the interface in `index.ts`, one file per adapter | One external service each: SDK calls, wire types, error mapping to Ramble's types, contract tests shared by every adapter (ARCH-8) | Business rules, markup |
| Server Actions | `src/server/actions/<area>.ts`, `'use server'` | Parse input with the action's Zod schema, get the caller, call one data-layer function, return its typed result | Queries, transactions, decisions |
| Synchronous components | `src/components/` | Markup from props; the primitives (one per Figma component, props named as the Figma properties, CSS Modules with tokens only) | Fetching, `src/server/` imports other than actions |
| Client islands | `src/components/`, `'use client'` | State and handlers for one interaction, from the allowlist below | Data for first paint, secrets, server modules |
| Async shells | `src/app/` pages and layouts, async Server Components, Route Handlers | Read params and search params, await the data layer, pass narrow props | A branch worth a unit test, a query, an SDK call |

**Imports point one way.**

```
src/app ──> src/components ──> src/lib
   │              │
   │              └──> src/server/actions   (client islands call actions; nothing else in src/server)
   └──> src/server ──> src/lib
```

- `src/lib` imports only `src/lib` and pure libraries (Zod, date math). It is safe in the browser.
- `src/server` imports `src/server` and `src/lib`, never `src/app` or `src/components`.
- `src/components` imports `src/components`, `src/lib`, and `src/server/actions`. Type-only imports (`import type`) from anywhere are allowed.
- `src/app` may import any layer.
- A vendor SDK (`drizzle-orm`, `@neondatabase/*`, `better-auth`, `stripe`, `resend`, `@vercel/blob`, `@sentry/*`, `botid`, `web-vitals`) is imported only inside its wrapper: `src/server/db/` for Drizzle and Neon, `src/server/auth/` for Better Auth, `src/server/ports/<port>/` for the rest, and the named analytics and monitoring wrappers (`stack-decisions.md`).

**Client islands allowlist** (design doc 4.1). Only these get `'use client'`: the booking bar, booking sheet, and booking panel; the date picker and calendar; the filter drawer; the checkout payment form; the hold timer; the order status poller; the event and web-vitals beacon; and the React Aria wrappers behind them (design doc 4.4). The shared client hooks are `useBookingDraft`, `useHoldCountdown`, and `useOrderStatus` (design doc 4.3). A new island or hook needs Dave's approval first, logged in `docs/plan/delta-log.md`; the unit's scope manifest then names it.

**Route Handlers** exist only for the machine endpoints in design doc 3.2: `/api/webhooks/payments`, `/api/webhooks/email`, `/api/pulse`, `/api/beacon/events`, `/api/beacon/vitals`, and file downloads. Each checks a signature or secret and is rate limited. Reads go through Server Components and writes through Server Actions.

**Route groups.** Guest, checkout, host, and ops are separate route groups (U-002). Fully dynamic routes that carry the nonce CSP (checkout, manage, ops) set `export const instant = false` and read the nonce in their own group's layout, never in the shared root layout (U-008a spike).

## In-scope file patterns

Paths are relative to `src/`.

```
app/**/*.ts, app/**/*.tsx                    # Async shells, Route Handlers
components/**/*.tsx, components/**/*.ts      # Synchronous components, primitives, client islands, client hooks
lib/**/*.ts                                  # Plain functions
server/**/*.ts                               # Data layer, Server Actions, ports and adapters
**/*.module.css                              # Component styles (rule B16)
```

Test files (`*.test.*`, `*.spec.*`, `e2e/**`) are read only to answer rules B7 and B11.

## Blocking rules (REQUEST_CHANGES on violation)

| # | Rule | What to look for |
|---|------|-----------------|
| B1 | Only the data layer touches the database or the network (ARCH-2, ARCH-5, DATA-1) | `fetch(`, a Drizzle or Neon call, or an SDK call in `app/**`, `components/**`, `lib/**`, or a `'use client'` file. Fix: a function in `src/server/` (outbound calls through a port) |
| B2 | Decisions live in `src/lib/` (ARCH-1, ARCH-4, design doc 4.3) | `.filter(`, `.sort(`, `.toSorted(`, `.reduce(`, money arithmetic, a parse, or a display string built inside a component, an effect, a Route Handler, a Server Action, or a data-layer function. Fix: a plain function in `src/lib/` with a unit test. Conditional rendering, `.map(` to markup, and SQL `WHERE` and `ORDER BY` clauses are not decisions |
| B3 | Every data-layer module is server-only (design doc 4.2 rule 1, RSC-5) | A file under `server/**` without `import 'server-only'` (Server Action files carry `'use server'` instead); a file outside `server/**` that reads a non-`NEXT_PUBLIC_` `process.env` value; any `process.env` read outside the one validated environment module (SET-19) |
| B4 | Imports point one way (ARCH-7) | Any import against the diagram above, including through relative paths (`../server/...`). ARCH-7 requires a lint rule; U-001's `import/no-restricted-paths` zones catch most, and the reviewer checks the rest |
| B5 | Validate at the boundary, return Ramble's types (design doc 4.2 rule 2, ARCH-3) | A Server Action, Route Handler, or exported data-layer function that uses its input before a Zod parse; a raw Drizzle row, provider object, or type named `*Response` or `*Dto` returned past `src/server/` or imported by `app/**` or `components/**` |
| B6 | Check the caller against the row (design doc 4.2 rule 3, SEC-1, SEC-3, U-116) | An exported data-layer function or Server Action that reads or writes a guest's, host's, or ops row without `requireRole(caller, role, resource)`, or that trusts a role or owner ID sent by the client. A page-level or proxy check alone is not enough. Capability-token routes check the derived token (`src/server/tokens.ts`) |
| B7 | No export that exists for a test (ARCH-6) | A non-type export from a component or data-layer file whose only importer is a test. Fix: move the logic to `src/lib/` |
| B8 | `'use client'` marks a leaf from the allowlist (RSC-2, design doc 4.1) | `'use client'` on a `page.tsx` or `layout.tsx`, or on any file not on the client islands allowlist |
| B9 | Multi-row changes are one transaction (design doc 4.2 rule 4) | A change that writes more than one row, or writes a row and its `jobs`, `audit_log`, or ledger row, outside a single `db.transaction`. A job enqueued, an email sent, or a provider called after the commit instead of through the outbox |
| B10 | Money and hold transactions follow design doc 4.2.3 | Locks taken out of the one lock order (device advisory lock, session row, hold, order, gift); a hold judged by a provider's `occurred_at` instead of `now()` at processing; a terminal state overwritten; a second live payment attempt on an order; a cash ledger posting before the provider's success event; a provider call without Ramble's IDs in metadata or without an idempotency key derived from Ramble's record ID (FORM-8) |
| B11 | Ports are the only door to a vendor (ARCH-8) | A vendor SDK imported outside its wrapper folder; a new adapter without the port's shared contract tests; a business rule inside an adapter |
| B12 | Money is integer cents, time comes from the clock (design doc 4.2, U-005) | A float, `toFixed`, or a dollars value in money code (amounts are integer minor units in USD); `Date.now()` or argument-less `new Date()` in `server/**` or `lib/**` outside the `clock` port's system adapter; a timestamp column that is not `timestamptz` in UTC; a session time without its IANA time zone |
| B13 | Errors propagate (ARCH-9) | An empty `catch`, or one that returns `undefined`, `null`, `[]`, or `{}`, in `lib/**` or `server/**`. One sanctioned exception: the single wrapper around `'use cache: remote'` reads catches the failure, logs it, and falls back to a direct Postgres read (U-009 spike) |
| B14 | Cached code never reads the caller (stricter than DATA-11, which allows it with the user id in the key, because Ramble's personal pages are all dynamic) | A `'use cache'` function, or a function it calls, that reads cookies, headers, `getCaller()`, a capability token, or personal data. Cached functions take every input as an argument and tag their output with `cacheTag`; publishing invalidates through `tagsForChange()` |
| B15 | Endpoints stay on the list | A new Route Handler outside design doc 3.2's machine endpoints, or one without a signature or secret check and a rate-limit key |
| B16 | Styles use tokens (UI-1, UI-2, ADR 0005, design doc 4.4) | An inline `style` prop (UI-1); a colour, spacing, radius, or font-size literal in a `*.module.css` file instead of a `var(--…)` token; a primitive whose props are not named as the Figma properties; a styling system other than CSS Modules |

## Advisory rules (notes only, do not block)

| # | Rule | What to look for |
|---|------|-----------------|
| A1 | A component is synchronous (ARCH-5) | An `async` component under `components/**`. An async Server Component belongs with the route that awaits it |
| A2 | Narrow props across the client boundary (RSC-3) | A whole record passed to a client island that reads one or two of its fields |
| A3 | A Server Component reads the data layer directly (RSC-10) | A server-side `fetch` to Ramble's own `/api/` route |
| A4 | Reuse before writing (ARCH-10) | A new helper, hook, component, or Zod schema that duplicates one already in the repo, or a decision function that repeats one listed in design doc 4.3 |
| A5 | Streamed parts keep their space (PRD-68, design doc 4.1) | A streamed region on a cached page (spaces left, upcoming dates) without a skeleton sized to the final content |
| A6 | Hooks are for shared state only (STATE-12) | A custom hook that wraps a pure decision (use the `src/lib/` function) or serves one component |

## Placement decisions (Dave, 2026-10-21)

1. **The email port lives at `src/server/ports/email/`.** The design doc and U-004a, U-006 say `lib/email`; read that as this path, since `src/lib/` holds no I/O.
2. **Server Actions live in `src/server/actions/`,** so client islands have one permitted import into `src/server/`.

Both are logged in `docs/plan/DECISIONS.md` and `docs/plan/delta-log.md`.
