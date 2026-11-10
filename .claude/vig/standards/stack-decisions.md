# Stack Decisions

Copy this file into `<project>/.claude/standards/stack-decisions.md` at project start and fill the last column. It settles every rule that [`react-nextjs.md`](react-nextjs.md) marks A (adapts per company). `senior` and `review` read the project copy; a blank cell means the default applies. The `plan-project` skill fills it during intake.

## Stack

| Item | This project |
|---|---|
| Framework and version | |
| React version | |
| Package manager (SET-14, SET-16) | |
| Node version (`engines`) | |
| Hosting and deploy target | |
| Backend contract (REST, GraphQL, RPC) and who owns it | |
| Web only, or web and mobile | |
| Analytics, monitoring, and feature-flag vendors (each gets a wrapper, ARCH-8) | |
| Design system or component library | |

## Decisions

| Rule | Decide | Default | This project |
|---|---|---|---|
| SET-1 | Where project files live: outside `app/`, colocated in route folders, or split by feature | Outside `app/`, under `src/` | |
| SET-2 | The feature count past which code is grouped by feature | A handful | |
| SET-6 | `exactOptionalPropertyTypes` on or off | Decide at setup | |
| SET-8 | typescript-eslint set: `recommended`, `strict`, or a type-checked set | `recommended` | |
| SET-11 | Formatter | Prettier | |
| SET-21 | Unused-code tool | Knip | |
| SET-22 | Route and page-prop types from `next typegen` | On | |
| DATA-4 | Schema library | Zod | |
| DATA-10 | Caching model: `cacheComponents: true` with `'use cache'`, or `force-cache` with `revalidate` | Decide before the first cached fetch | |
| DATA-13 | Client-side data library | None until components share a browser cache | |
| FORM-6 | Which interactions get optimistic UI | Decide per interaction | |
| FORM-8 | Which requests can be retried, and so carry an idempotency key | Decide per write endpoint | |
| STATE-11 | Reducers for state that handlers update together | On | |
| STATE-14 | React Compiler on or off | Decide at setup | |
| TEST-2 | Unit and component test runner | Vitest (Jest stays in a repo that already has it) | |
| TEST-5 | Network mocking: MSW or stubbed `fetch` | Decide at setup | |
| TEST-16 | Mutation check on agent-written tests: by hand or with a tool | By hand | |
| UI-2 | Styling system: CSS Modules or Tailwind | CSS Modules beside the component | |
| PERF-6 | Bundle analyzer | Decide before the first dependency review | |
| PERF-7 | Hand memoization | Follows STATE-14: none in new code when the compiler is on | |
| SEC-10 | Content Security Policy | Report-only first | |

## Departures

Fixed rules this project cannot follow yet, each with the reason and the condition for removing the exception.

| Rule | Reason | Remove when |
|---|---|---|
| | | |
