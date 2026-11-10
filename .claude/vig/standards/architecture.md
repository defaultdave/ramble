# Architecture Standards

The default architecture rules, taken from section 1 of [`react-nextjs.md`](react-nextjs.md). The principle behind every row: write code so a unit test can reach every decision in it.

`architecture-audit` reads the target project's `.claude/standards/architecture.md`. When the project has none, it reads this file. To change a rule for one project, copy this file into `<project>/.claude/standards/architecture.md` and edit the copy: move a row between the tables, delete it, or change the paths. A project file with both tables empty turns the audit off for that project.

## Layers

| Kind | Lives in | Holds | Never holds |
|---|---|---|---|
| Plain functions | `lib/` | Every decision: filter, sort, parse, format, pick a state | React, I/O |
| Service modules | `lib/` | One external service: URL, headers, schema, error mapping | Markup |
| Synchronous components | `components/` | Markup from props | Fetching |
| Client islands | `components/`, `'use client'` | State and event handlers for one interaction | Data for first paint |
| Async shells | `app/` pages, async Server Components, Route Handlers, Server Actions | Read input, await the service, pass props | A branch worth a unit test |

Imports point one way: `app` to `components` to `lib`.

## In-scope file patterns

Paths are relative to the source root (`src/` when the project has one).

```
app/**/*.ts, app/**/*.tsx                          # Async shells
components/**/*.tsx, **/*.tsx, **/*.jsx            # Synchronous components and client islands
lib/**/*.ts, **/services/**/*.ts, **/api/**/*.ts   # Plain functions and service modules
features/**/*.ts, features/**/*.tsx                # Feature folders, when the project groups by feature
**/hooks/**/*.ts                                   # React hooks
**/helpers/**/*.ts, **/utils/**/*.ts               # Utility layer
```

Test files (`*.test.*`, `*.spec.*`, `e2e/**`) are read only to answer rule B7.

## Blocking rules (REQUEST_CHANGES on violation)

| # | Rule | What to look for |
|---|------|-----------------|
| B1 | Only a service module calls the network (ARCH-2, ARCH-5, DATA-1) | `fetch(`, `axios`, `ky`, or a database or HTTP client call in `components/**`, `app/**`, a hook, or a `'use client'` file. Fix: call a function exported from the service module in `lib/` |
| B2 | Decisions live in named functions (ARCH-1, ARCH-4) | `.filter(`, `.sort(`, `.toSorted(`, `.reduce(`, a parse, or a URL or display string built inside a component body, an effect, a Route Handler, or a Server Action. Fix: a function in `lib/` that takes values and returns a value. Conditional rendering and `.map(` to markup are not decisions |
| B3 | Wire types stay in the service module (ARCH-3) | A type named `*Response` or `*Dto` declared in or imported by a file under `components/**` or `app/**`. Fix: map to an app type inside the service module |
| B4 | Imports point one way (ARCH-7) | A `lib/**` file importing from `components/**` or `app/**`; a `components/**` file importing from `app/**`; a `features/<a>/**` file importing from `features/<b>/**` |
| B5 | Third-party SDKs sit behind a wrapper (ARCH-8) | A direct import of an analytics, monitoring, or feature-flag SDK in `components/**` or `app/**`. Fix: import the project's wrapper module |
| B6 | Errors propagate (ARCH-9) | An empty `catch`, or a `catch` that returns `undefined`, `null`, `[]`, or `{}`, in `lib/**`, a service module, a helper, or a utility |
| B7 | No export that exists for a test (ARCH-6) | A non-type export from a component file whose only importer is a test file. Fix: move the function to `lib/`, where the component imports it too |
| B8 | `'use client'` marks a leaf (RSC-2) | `'use client'` at the top of a `page.tsx` or `layout.tsx` |

## Advisory rules (notes only, do not block)

| # | Rule | What to look for |
|---|------|-----------------|
| A1 | A component is synchronous (ARCH-5) | An `async` component under `components/**`. An async Server Component belongs with the route that awaits it |
| A2 | Server-only modules say so (RSC-5) | A module that reads a secret (`process.env.*` without the `NEXT_PUBLIC_` prefix) or imports a database client, with no `import 'server-only'` |
| A3 | A Server Component reads the data layer directly (RSC-10) | A server-side `fetch` to the app's own `/api/` route |
| A4 | Narrow props across the client boundary (RSC-3) | A whole record or API object passed to a `'use client'` component that reads one or two of its fields |
| A5 | Reuse before writing (ARCH-10) | A new helper, hook, or component that duplicates one already in the repo |
| A6 | One caching decision per request (DATA-9, DATA-11) | A cached function that reads the current user with no user id in its cache key |
