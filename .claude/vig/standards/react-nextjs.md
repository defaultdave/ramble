# React and Next.js Standards

Company-agnostic rules for React and Next.js App Router projects. 156 rules in 12 sections. 120 cite an official doc or a named industry source; 36 are house rules and say why.

- **Who reads it:** `senior` reads the sections that match the work before implementing; `review` walks section 13 on a React or Next.js diff. The `code-standards` rule carries the short form that loads on every JS/TS edit.
- **Per project:** a rule marked A is settled in the project's `.claude/standards/stack-decisions.md` (template beside this file). Where that file is silent, the default in the rule applies.
- **Baseline:** Next.js 16.4.1 or later, App Router, React 19.3, TypeScript `strict`. Updated 2026-10-18: 16.4.1 fixes two Critical advisories published 2026-10-14, one of them in `use cache`. The rules below were checked against 16.3.8 on 2026-10-06 and have not been re-checked against 16.4.
- **F / A:** F is fixed, the same at every company. A adapts to the company's stack, and the rule says what to decide.
- **Source column:** a link is an official doc or a named industry source. "House" is a house rule with its reason; no outside source says it in those words.
- **How the links were checked:** section 14.

## The 12 that matter most

| # | Rule | Section |
|---|---|---|
| 1 | Write code so a unit test can reach every decision in it: plain functions, synchronous components, thin async shells | 1 |
| 2 | One module per external service owns its URL, schema and errors. Nothing else calls that service | 1, 4 |
| 3 | Server first. `'use client'` goes on the smallest component that needs state or a handler | 3 |
| 4 | Shareable state (search, filter, page) lives in the URL | 5 |
| 5 | One state value per fact. Derive the rest during render | 6 |
| 6 | Type external data as it is returned and parse it at the boundary. No casts | 7 |
| 7 | Every Server Action and Route Handler checks who is calling and validates its input | 12 |
| 8 | Test each layer with the cheapest tool that reaches it. One end-to-end test per async shell. One test per behaviour, not per line: agents over-generate | 8 |
| 9 | Label, landmark, heading, list. Then walk the page with a keyboard and a screen reader | 10 |
| 10 | Reserve space for anything that loads late. Judge performance on field data at the 75th percentile | 9, 11 |
| 11 | A configured tool has a script and runs in CI | 2 |
| 12 | Stay on a patched framework release | 12 |

---

## 1. Architecture: three kinds of code

**The principle:** write code so a unit test can reach every decision in it.

| Kind | Lives in | Holds | Never holds | Test |
|---|---|---|---|---|
| Plain functions | `lib/` | Every decision: filter, sort, parse, format, pick a state | React, I/O | Unit |
| Service modules | `lib/` | One external service: URL, headers, schema, error mapping | Markup | Unit, `fetch` stubbed |
| Synchronous components | `components/` | Markup from props | Fetching | Component |
| Client islands | `components/`, `'use client'` | State and event handlers for one interaction | Data for first paint | Component |
| Async shells | `app/` pages, async Server Components, Route Handlers, Server Actions | Read input, await the service, pass props | A branch worth a unit test | One end-to-end test each |

**The check while writing:** an `if`, a `filter`, a `sort` or a template string typed inside a component, an effect or a route file belongs in a function in `lib/`.

| ID | Rule | F/A | Source |
|---|---|---|---|
| ARCH-1 | Every decision is a named function that takes values and returns a value, in a module its caller imports | F | [Bernhardt, Boundaries](https://www.destroyallsoftware.com/talks/boundaries) (my paraphrase of the talk); [React: a reducer is pure and can be tested in isolation](https://react.dev/learn/extracting-state-logic-into-a-reducer#comparing-usestate-and-usereducer) |
| ARCH-2 | One module per external service. Nothing else calls `fetch` against that service | F | [Next: Data Access Layer](https://nextjs.org/docs/app/guides/data-security) |
| ARCH-3 | The service module maps the wire shape to an app type. `*Response` and `*Dto` types do not reach components | F | [Next: return minimal DTOs](https://nextjs.org/docs/app/guides/data-security) |
| ARCH-4 | An async shell reads input, awaits, and passes props. If a branch in it needs a unit test, move the branch out | F | [Next: Vitest does not support async Server Components](https://nextjs.org/docs/app/guides/testing/vitest) |
| ARCH-5 | A component is synchronous and renders its props. It does not fetch and does not change what it was given | F | [React: keeping components pure](https://react.dev/learn/keeping-components-pure) |
| ARCH-6 | Do not export a function from a component file only so a test can import it. Put it in `lib/`, where the component imports it too | F | House. A test-only export is an internal leaked for testability |
| ARCH-7 | Imports point one way: `app` to `components` to `lib`. Enforce it with a lint rule | F | [Bulletproof React: project structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md); [`import/no-restricted-paths`](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-restricted-paths.md); [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) |
| ARCH-8 | Third-party SDKs (analytics, monitoring, flags) sit behind a wrapper module. Components import the wrapper | F | House. One place to swap, mock and audit |
| ARCH-9 | Errors propagate. No `catch { return undefined }` in a helper or service | F | House. A swallowed error surfaces later, far from its cause |
| ARCH-10 | Search for an existing helper, hook or component before writing a new one | F | [Google: what to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html) |

### Worked example

A product search page. Verified 2026-10-06 in a scratch project: `tsc --noEmit` exit 0 (TypeScript 5.9.3, Next 16.3.8 types, `strict` plus `noUncheckedIndexedAccess`), ESLint 9.39.5 with `eslint-config-next` 16.3.8 and `eqeqeq` clean, 8 of 8 unit tests pass on Vitest 1.2.1. Not run: `next build`, the component test and the Playwright test in section 8.

```
src/
  app/
    layout.tsx
    page.tsx              async shell
    error.tsx
  components/
    SearchForm.tsx        + SearchForm.test.tsx
    ProductList.tsx       + ProductList.test.tsx, ProductList.module.css
    ProductCard.tsx
    FavoriteButton.tsx    client island
  lib/
    catalog.ts            + catalog.test.ts     service module
    products.ts           + products.test.ts    decisions
  types.ts
e2e/
  search.spec.ts
```

```ts
// src/lib/products.ts
import type { Product } from '@/types'

/** Products to show, best rated first. Returns a new array. */
export function rankProducts(products: Product[]): Product[] {
  return products
    .filter((product) => product.stock > 0)
    .toSorted((a, b) => b.rating - a.rating)
}

/** A price for display, such as "$1,299.00". */
export function formatPrice(amount: number, locale = 'en-US', currency = 'USD'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
}
```

```ts
// src/lib/catalog.ts
import { z } from 'zod'
import type { Product } from '@/types'

const SEARCH_URL = 'https://api.example.com/products/search'

// The response as the API sends it. A field the API can send as null is nullable here.
const searchResponseSchema = z.object({
  products: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      price: z.number(),
      rating: z.number(),
      stock: z.number(),
      thumbnail: z.string().nullable(),
    }),
  ),
})

/** The search request URL. The term is encoded, so it cannot add parameters. */
export function buildSearchUrl(term: string): URL {
  const url = new URL(SEARCH_URL)
  url.searchParams.set('q', term)
  return url
}

/**
 * Search the catalog.
 * @throws when the API answers with a non-2xx status or an unexpected shape.
 */
export async function searchProducts(term: string): Promise<Product[]> {
  const res = await fetch(buildSearchUrl(term))
  if (!res.ok) {
    throw new Error(`Catalog search failed with status ${res.status}`)
  }
  return searchResponseSchema.parse(await res.json()).products
}
```

```tsx
// src/app/page.tsx
import { Suspense } from 'react'
import ProductList, { ProductListSkeleton } from '@/components/ProductList'
import SearchForm from '@/components/SearchForm'
import { searchProducts } from '@/lib/catalog'
import { rankProducts } from '@/lib/products'

type Props = { searchParams: Promise<{ q?: string }> }

export default async function Page({ searchParams }: Props) {
  const { q = '' } = await searchParams

  return (
    <main>
      <h1>Catalog</h1>
      <SearchForm defaultValue={q} />
      <Suspense key={q} fallback={<ProductListSkeleton />}>
        <SearchResults term={q} />
      </Suspense>
    </main>
  )
}

/** The async shell: await the service, call the pure function, pass props. */
async function SearchResults({ term }: { term: string }) {
  const products = await searchProducts(term)

  return <ProductList products={rankProducts(products)} />
}
```

```tsx
// src/components/SearchForm.tsx
import Form from 'next/form'

/** A GET form: submitting puts the term in the URL as ?q=. */
export default function SearchForm({ defaultValue }: { defaultValue: string }) {
  return (
    <Form action="/" role="search">
      <label htmlFor="q">Search products</label>
      <input id="q" name="q" type="search" defaultValue={defaultValue} />
      <button type="submit">Search</button>
    </Form>
  )
}
```

```ts
// src/lib/products.test.ts (3 of the 8 tests)
it('puts the best rated first', () => {
  const ranked = rankProducts([product(1, 3.1), product(2, 4.8), product(3, 4.2)])
  expect(ranked.map((p) => p.id)).toEqual([2, 3, 1])
})

it('leaves the array it was given in the order it came', () => {
  const input = [product(1, 3.1), product(2, 4.8)]
  rankProducts(input)
  expect(input.map((p) => p.id)).toEqual([1, 2])
})

// src/lib/catalog.test.ts
it('keeps a term with & and = as one q value', () => {
  const url = buildSearchUrl('tea&limit=500')
  expect(url.searchParams.get('q')).toBe('tea&limit=500')
  expect(url.searchParams.get('limit')).toBeNull()
})
```

What the page has no need for: `useState`, `useEffect`, a loading flag, an error flag, a key handler.

---

## 2. Project setup

### Folder layout

Next.js does not mandate a layout. Its docs list three strategies and say to pick one and be consistent ([Next: project structure](https://nextjs.org/docs/app/getting-started/project-structure)).

| ID | Rule | F/A | Source |
|---|---|---|---|
| SET-1 | Default: project files outside `app/`, under `src/`. `app/` holds route files only | A. Decide: outside `app`, colocated in route folders, or split by feature | [Next: project structure](https://nextjs.org/docs/app/getting-started/project-structure) |
| SET-2 | Past a handful of features, group by feature (`features/<name>/{components,lib}`) and ban imports between features | A. Decide the threshold | [Bulletproof React](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md); [Feature-Sliced Design: layers](https://feature-sliced.design/docs/reference/layers) |
| SET-3 | Folders are lowercase. A file is named for its main export. A test sits beside the file it covers | F | House. One rule a newcomer can guess |
| SET-4 | Imports use the `@/*` alias from `tsconfig.json`, not `../../` | F | [Next: installation, paths and baseUrl](https://nextjs.org/docs/app/getting-started/installation) |
| SET-5 | Shared types live in `types.ts` or beside their feature. A type is named for the domain object and never shadows a global (`Response`, `Error`, `Event`) | F | House |

### Tooling

| ID | Rule | F/A | Source |
|---|---|---|---|
| SET-6 | `tsconfig.json`: `strict` on, plus `noUncheckedIndexedAccess`. Neither it nor `exactOptionalPropertyTypes` is part of `strict` | F for the first two. A for `exactOptionalPropertyTypes` | [TSConfig reference](https://www.typescriptlang.org/tsconfig/) |
| SET-7 | ESLint runs through its own CLI with a flat config. `next lint` was removed in Next 16 and `next build` no longer lints | F | [Next: ESLint](https://nextjs.org/docs/app/api-reference/config/eslint); [Next: upgrading to 16](https://nextjs.org/docs/app/guides/upgrading/version-16) |
| SET-8 | Lint config: `eslint-config-next/core-web-vitals`, `eslint-config-next/typescript`, typescript-eslint `recommended` or stricter, and `eqeqeq` | F for the list. A for `strict` and the type-checked sets | [typescript-eslint: shared configs](https://typescript-eslint.io/users/configs/); [ESLint: eqeqeq](https://eslint.org/docs/latest/rules/eqeqeq) |
| SET-9 | `eslint-plugin-react-hooks` `recommended` is on. It carries the Rules of Hooks and the React Compiler rules | F | [React: eslint-plugin-react-hooks](https://react.dev/reference/eslint-plugin-react-hooks) |
| SET-10 | `eslint-plugin-jsx-a11y` is on | F | [eslint-plugin-jsx-a11y](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y) |
| SET-11 | Prettier formats, ESLint finds bugs. `eslint-config-prettier` removes the overlap. CI runs `prettier --check` | F. A if the company uses Biome | [Prettier vs linters](https://prettier.io/docs/comparison); [Prettier: integrating with linters](https://prettier.io/docs/integrating-with-linters); [Prettier CLI](https://prettier.io/docs/cli) |
| SET-12 | A formatter or linter in `package.json` has a script and runs in CI. If nothing runs it, delete it | F | House. Unrun config reads as a guarantee and gives none |
| SET-13 | `test` is one-shot. Bare `vitest` starts watch mode | F | [Vitest guide](https://vitest.dev/guide/) |
| SET-14 | CI installs with `npm ci`, which fails when the lockfile and `package.json` disagree | F. A for the package manager | [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci) |
| SET-15 | Test and build tooling is in `devDependencies`. `engines` states the Node version | F | [npm: package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json) |
| SET-16 | If the repo pins a package manager with `packageManager`, document the Corepack install. Node 25 no longer bundles it | A | [Corepack](https://github.com/nodejs/corepack#readme) |
| SET-17 | CI gates every merge on lint, typecheck, test and build, with `permissions:` set to the least the job needs | F | [GitHub: GITHUB_TOKEN permissions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication); [actions/setup-node](https://github.com/actions/setup-node) |
| SET-18 | Config that differs between deploys lives in the environment. No `.env` file is committed; `.env.example` is | F | [Twelve-Factor: config](https://12factor.net/config); [Next: environment variables](https://nextjs.org/docs/app/guides/environment-variables) |
| SET-19 | Environment variables are read and validated once, in one module, at start-up | F | House. A missing variable fails at boot, not on the first request that needs it |
| SET-20 | A secret never has the `NEXT_PUBLIC_` prefix. Those values are inlined into the client bundle at build time | F | [Next: environment variables](https://nextjs.org/docs/app/guides/environment-variables) |
| SET-21 | Unused files, exports and dependencies are removed. Knip finds them | F. A for the tool | [Knip](https://knip.dev/) |
| SET-22 | Types for routes and page props come from `next typegen` (`PageProps`, `LayoutProps`), and `typecheck` runs it first | A | [Next: TypeScript](https://nextjs.org/docs/app/api-reference/config/typescript); [Next: page](https://nextjs.org/docs/app/api-reference/file-conventions/page) |

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "typecheck": "next typegen && tsc --noEmit",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test"
}
```

---

## 3. Server and client components

| ID | Rule | F/A | Source |
|---|---|---|---|
| RSC-1 | Pages and layouts are Server Components by default. Leave them that way | F | [Next: server and client components](https://nextjs.org/docs/app/getting-started/server-and-client-components) |
| RSC-2 | `'use client'` marks a boundary: the file's imports join the client bundle. Put it on the smallest interactive component, never on a page or layout | F | [Next: server and client components](https://nextjs.org/docs/app/getting-started/server-and-client-components); [React: 'use client'](https://react.dev/reference/rsc/use-client) |
| RSC-3 | Props that cross to a Client Component are serializable. Pass a narrow object, never a whole database row | F | [React: 'use client'](https://react.dev/reference/rsc/use-client); [Next: data security](https://nextjs.org/docs/app/guides/data-security) |
| RSC-4 | To put server UI inside a client wrapper (modal, tabs), pass it as `children` | F | [Next: server and client components](https://nextjs.org/docs/app/getting-started/server-and-client-components); [Next: server and client boundary](https://nextjs.org/docs/app/guides/server-and-client-boundary) |
| RSC-5 | Modules that touch the database or secrets start with `import 'server-only'`, so importing one from client code fails the build | F | [Next: server and client components](https://nextjs.org/docs/app/getting-started/server-and-client-components) |
| RSC-6 | `params` and `searchParams` are Promises. Await them | F from Next 15 | [Next: page](https://nextjs.org/docs/app/api-reference/file-conventions/page) |
| RSC-7 | Context providers are Client Components that take `children`, placed as deep in the tree as they can go | F | [Next: server and client components](https://nextjs.org/docs/app/getting-started/server-and-client-components) |
| RSC-8 | No `typeof window`, `Math.random()` or locale-formatted dates in render. They differ between server and client and break hydration | F | House, from review. The purity rule behind it: [React: keeping components pure](https://react.dev/learn/keeping-components-pure) |
| RSC-9 | No `cookies()` or `headers()` in a shared layout unless every route under it must be dynamic | F | House, from review. One call makes the whole subtree dynamic |
| RSC-10 | A Server Component reads from the data layer directly. It does not fetch the app's own Route Handler | F | [Next: backend for frontend](https://nextjs.org/docs/app/guides/backend-for-frontend) |
| RSC-11 | Middleware is `proxy.ts` from Next 16. It is not the only authorization check | F | [Next: proxy](https://nextjs.org/docs/app/getting-started/proxy); section 12 |

### Islands: the names

| Term | Whose | Meaning | Next.js equivalent |
|---|---|---|---|
| Islands architecture | [Jason Miller, 2020](https://jasonformat.com/islands-architecture/); [patterns.dev](https://www.patterns.dev/vanilla/islands-architecture/) | Static HTML with small independent zones of interactivity | A Server Component tree with `'use client'` leaves |
| Server islands | [Astro](https://docs.astro.build/en/concepts/islands/) | Slow server-rendered parts moved out of the main render | An async Server Component inside `<Suspense>` |
| Partial Prerendering | [Next: caching](https://nextjs.org/docs/app/getting-started/caching) | A static shell served at once, dynamic content streamed in | On only with `cacheComponents: true` ([config](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents)) |

The Next 16.3.8 docs never use the phrase "server island". Say "streamed Server Component" or "Partial Prerendering" in a Next codebase.

---

## 4. Data fetching and caching

| ID | Rule | F/A | Source |
|---|---|---|---|
| DATA-1 | Fetch in a Server Component, through the service module | F | [Next: fetching data](https://nextjs.org/docs/app/getting-started/fetching-data) |
| DATA-2 | Check `response.ok` before parsing. `fetch` resolves on a 404 or a 500 | F | [MDN: using Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch) |
| DATA-3 | Build URLs with `URL` and `URLSearchParams`. Never interpolate input into a URL string | F | [MDN: URLSearchParams](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams) |
| DATA-4 | Parse the response with a schema at the boundary and derive or check the type from it | F. A for the library | [Zod](https://zod.dev/); [Standard Schema](https://standardschema.dev/) |
| DATA-5 | A value the API or config supplies (a base URL, a page size) is read from there, not hardcoded | F | House. The hardcoded copy drifts from the source |
| DATA-6 | Independent requests start together (`Promise.all`), or each component fetches inside its own `<Suspense>`. Sequential awaits are a waterfall | F | [Next: fetching data](https://nextjs.org/docs/app/getting-started/fetching-data) |
| DATA-7 | `loading.tsx` or `<Suspense>` streams slow parts. Call `notFound()` before the first `await` or `<Suspense>`: the status code cannot change once streaming starts | F | [Next: loading](https://nextjs.org/docs/app/api-reference/file-conventions/loading); [Next: streaming](https://nextjs.org/docs/app/guides/streaming) |
| DATA-8 | `error.tsx` is a Client Component and offers `retry()`, stable since 16.3.0. `reset()` does not re-fetch | F from 16.3 | [Next: error](https://nextjs.org/docs/app/api-reference/file-conventions/error) |
| DATA-9 | `fetch` is not cached by default. Caching is a decision written down per request | F | [Next: fetch](https://nextjs.org/docs/app/api-reference/functions/fetch) |
| DATA-10 | One caching model per project: `cacheComponents: true` with `'use cache'`, `cacheLife` and `cacheTag`, or without it `cache: 'force-cache'` and `next: { revalidate }` | A. Decide the model | [Next: caching](https://nextjs.org/docs/app/getting-started/caching); [Next: caching without Cache Components](https://nextjs.org/docs/app/guides/caching-without-cache-components) |
| DATA-11 | Never cache a function that reads the current user unless the user id is in the cache key | F | House, from review. One user's data is served to the next |
| DATA-12 | A server-side fetch to a rate-limited API sets a cache lifetime. Every visitor shares the server's IP | F | House |
| DATA-13 | Client-side fetching is for polling, per-keystroke data and client-owned caches. Use `use()` with a promise from the server, or a library when components share a browser cache | A. Decide the library (TanStack Query, SWR) | [Next: client-side data fetching](https://nextjs.org/docs/app/guides/client-side-data-fetching); [TanStack Query: advanced SSR](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr) |
| DATA-14 | An effect that fetches has a cleanup that ignores or aborts the stale request. Abort is better: it also cancels the network call | F | [React: you might not need an Effect, fetching data](https://react.dev/learn/you-might-not-need-an-effect#fetching-data); [MDN: AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController) |
| DATA-15 | Lists from an API are paginated or sliced. No fetch inside a list item | F | House, from review |

---

## 5. Mutations, forms and URL state

| ID | Rule | F/A | Source |
|---|---|---|---|
| FORM-1 | A search term, filter or page number is a query parameter. The search then has a URL: it can be shared, bookmarked and reached with Back | F | [Next: Form](https://nextjs.org/docs/app/api-reference/components/form) |
| FORM-2 | Inputs sit in a `<form>` with a submit button. Enter and click both submit, with no key handler | F | [MDN: submit event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/submit_event); [HTML spec: implicit submission](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#implicit-submission) |
| FORM-3 | Mutations are Server Actions passed to `<form action>`. In a Server Component the form submits before JavaScript loads | F | [Next: mutating data](https://nextjs.org/docs/app/getting-started/mutating-data); [React: form](https://react.dev/reference/react-dom/components/form) |
| FORM-4 | An expected failure (validation, conflict) is a return value read with `useActionState`. An unexpected one throws to `error.tsx` | F | [React: useActionState](https://react.dev/reference/react/useActionState) |
| FORM-5 | Pending state comes from `useActionState` or `useFormStatus`. The submit button is disabled while pending | F | [React: useFormStatus](https://react.dev/reference/react-dom/hooks/useFormStatus) |
| FORM-6 | Optimistic UI uses `useOptimistic`, shows an error and rolls back on failure | A | [React: useOptimistic](https://react.dev/reference/react/useOptimistic) |
| FORM-7 | An input is controlled or uncontrolled, never both. A controlled value starts as `''`, not `undefined` | F | House, from review |
| FORM-8 | A request that can be retried carries an idempotency key that is stable across retries | A | House, from review |

---

## 6. State and effects

| ID | Rule | F/A | Source |
|---|---|---|---|
| STATE-1 | One state value per fact. A request's status is one union (`idle`, `loading`, `error`, `success`), not parallel booleans that can disagree | F | [React: avoid contradictions in state](https://react.dev/learn/choosing-the-state-structure#avoid-contradictions-in-state) |
| STATE-2 | A value that can be computed from props or state is computed during render, not stored and synced | F | [React: you might not need an Effect](https://react.dev/learn/you-might-not-need-an-effect#updating-state-based-on-props-or-state) |
| STATE-3 | Logic caused by a user action runs in the event handler, not in an effect that watches state | F | [React: you might not need an Effect](https://react.dev/learn/you-might-not-need-an-effect#sharing-logic-between-event-handlers) |
| STATE-4 | Every effect that subscribes, listens or times has a cleanup. Strict Mode runs effects an extra time in development to expose a missing one | F | [React: synchronizing with Effects](https://react.dev/learn/synchronizing-with-effects#step-3-add-cleanup-if-needed); [React: StrictMode](https://react.dev/reference/react/StrictMode) |
| STATE-5 | Never mutate props, state or anything passed in. Copy before `sort`, `reverse` or `splice`, or use `toSorted` | F | [React: rules of React](https://react.dev/reference/rules#components-and-hooks-must-be-pure); [React: updating arrays in state](https://react.dev/learn/updating-arrays-in-state); [MDN: Array.sort](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort) |
| STATE-6 | A key is a stable id, unique among siblings. Not the array index on a list that sorts, filters or grows | F | [React: rendering lists](https://react.dev/learn/rendering-lists) |
| STATE-7 | State lives in the closest common parent of the components that use it. Each piece has one owner | F | [React: sharing state between components](https://react.dev/learn/sharing-state-between-components#a-single-source-of-truth-for-each-state) |
| STATE-8 | Store an id, not a copy of the selected item | F | [React: choosing the state structure](https://react.dev/learn/choosing-the-state-structure) |
| STATE-9 | When the next value depends on the previous one, use the updater form: `setCount((n) => n + 1)` | F | House. A stale closure otherwise |
| STATE-10 | Reset a component's state on a prop change with `key`, not an effect | F | [React: you might not need an Effect](https://react.dev/learn/you-might-not-need-an-effect) |
| STATE-11 | State that handlers update together goes in a reducer. The reducer is a pure function with its own unit tests | A | [React: extracting state logic into a reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer) |
| STATE-12 | A custom Hook shares stateful logic and is named for what it does. No lifecycle wrappers such as `useMount` | F | [React: reusing logic with custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) |
| STATE-13 | Server data is not copied into client state. It stays in props or in the client cache library | F | [TanStack Query: overview](https://tanstack.com/query/latest/docs/framework/react/overview) |
| STATE-14 | React Compiler is stable (1.0, October 2025). With it on, new code does not hand-memoize; `useMemo` and `useCallback` stay where an effect depends on the value | A. Decide: compiler on or off | [React Compiler 1.0](https://react.dev/blog/2025/10/07/react-compiler-1) |
| STATE-15 | No component declared inside another component's body | F | House, from review. It remounts on every render |

---

## 7. TypeScript

| ID | Rule | F/A | Source |
|---|---|---|---|
| TS-1 | No `any`. Use `unknown` and narrow it | F | [TS handbook: everyday types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html) |
| TS-2 | External data is typed as returned: a field the API can send as `null` is nullable | F | House. The compiler cannot warn about a `null` the type denies |
| TS-3 | No `as` cast on parsed data and no `as unknown as T`. An assertion has no runtime check | F | [TS handbook: type assertions](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html) |
| TS-4 | A type argument, not a cast: `useState<Product[]>([])` | F | House |
| TS-5 | States that exclude each other are a discriminated union, and a `switch` over it handles every member with a `never` check | F | [TS handbook: narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) |
| TS-6 | No non-null `!` on a lookup. No `@ts-ignore` or `@ts-expect-error` without a reason on the same line | F | House, from review |
| TS-7 | Reuse an existing type. Do not redeclare its fields in a props interface | F | House. Two copies drift |
| TS-8 | `import type` for type-only imports | F | House, from review. It also keeps server types out of client bundles |
| TS-9 | `??` for defaults where `0`, `''` or `false` is a valid value, not `||` | F | House, from review |
| TS-10 | `===` only | F | [MDN: equality comparisons](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness) |

---

## 8. Testing

| Layer | What | Tool | How many |
|---|---|---|---|
| Static | Types, lint | `tsc`, ESLint | Every file |
| Unit | Plain functions, reducers, service modules with `fetch` stubbed | Vitest, `node` environment | Many. Every branch |
| Component | Synchronous Server and Client Components, with user interaction | Vitest with jsdom, Testing Library, user-event | One file per component with behaviour |
| End to end | Each async shell: page, action, route | Playwright against a production build | One per shell, critical paths first |

This is the Testing Trophy with section 1 applied: unit tests cover the decisions, component tests are the integration layer, and end-to-end tests are few because the async shells hold no logic ([Dodds: testing trophy](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications); [Vocke: practical test pyramid](https://martinfowler.com/articles/practical-test-pyramid.html); [Google: just say no to more end-to-end tests](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html)).

| ID | Rule | F/A | Source |
|---|---|---|---|
| TEST-1 | An `async` Server Component gets an end-to-end test. Vitest cannot render it | F while the limit stands | [Next: Vitest](https://nextjs.org/docs/app/guides/testing/vitest) |
| TEST-2 | Setup follows the Next guide: `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/dom`, `vite-tsconfig-paths`; `environment: 'jsdom'`; `defineConfig` from `vitest/config` | F. A for Jest in an existing repo | [Next: Vitest](https://nextjs.org/docs/app/guides/testing/vitest); [Vitest: environment](https://vitest.dev/config/environment) |
| TEST-3 | Tests resemble use. Query by role and accessible name first, `getByLabelText` for fields, `getByTestId` last | F | [Testing Library: guiding principles](https://testing-library.com/docs/guiding-principles/); [query priority](https://testing-library.com/docs/queries/about/) |
| TEST-4 | Interactions go through `user-event`, which simulates the full interaction | F | [Testing Library: user-event](https://testing-library.com/docs/user-event/intro/) |
| TEST-5 | Mock the network, not your own modules. MSW handlers work in tests and in the browser. Unhandled requests are an error | A. Decide: MSW or stubbed `fetch` | [MSW](https://mswjs.io/) |
| TEST-6 | Mocks cover failure (4xx, 5xx, timeout) and match the real API's shape | F | House, from review. A fixture that differs from the API tests nothing |
| TEST-7 | A test asserts behaviour. Not `toBeDefined()`, not "fetch was called", not a snapshot alone | F | [Testing Library: guiding principles](https://testing-library.com/docs/guiding-principles/) |
| TEST-8 | A fix ships with a test that fails without it. Check by breaking one line and rerunning | F | House |
| TEST-9 | No `.only`, `.skip` or `.todo` merged. Time and randomness are fixed in tests | F | House, from review |
| TEST-10 | Playwright tests are isolated, use user-facing locators and web-first assertions, and mock third parties | F | [Playwright: best practices](https://playwright.dev/docs/best-practices) |
| TEST-11 | End-to-end tests run against a production build | F | [Next: Playwright](https://nextjs.org/docs/app/guides/testing/playwright) |
| TEST-12 | An axe scan runs in component tests and in one end-to-end test. It finds part of the issues, not all (section 10) | F | [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md) |
| TEST-13 | A test earns its place by failing for a reason no other test fails for. Cases that exercise the same branch go in one `it.each` table, not one `it` each | F | House. Agent-written suites run long with near-duplicates |
| TEST-14 | Write the list of behaviours before any test code: one line per decision, branch or risk. Review the list, then write the tests. Cap each file at its list | F | House, same reason |
| TEST-15 | Cover each branch once, at the cheapest layer. If a unit test covers the branch, the component test covers only the wiring and the end-to-end test covers the path once | F | House. Extends rule 8 |
| TEST-16 | Reviewing agent-written tests: break one line of the code and see which tests fail. If three fail together for the same break, keep one. Delete a test whose removal leaves every break still caught | A. A mutation tool could automate this; not evaluated | House |
| TEST-17 | Tell the agent the budget in the prompt ("one table-driven test per function, no assertion that restates the code"). Size and count of tests is a review item like any other | F | House |

Not run here; shapes follow the linked docs:

```tsx
// src/components/SearchForm.test.tsx
it('labels the search box', () => {
  render(<SearchForm defaultValue="tea" />)
  expect(screen.getByRole('searchbox', { name: /search products/i })).toHaveValue('tea')
})
```

```ts
// e2e/search.spec.ts
test('a search shows ranked results', async ({ page }) => {
  await page.goto('/?q=tea')
  await expect(page.getByRole('heading', { level: 1, name: 'Catalog' })).toBeVisible()
  await expect(page.getByRole('listitem').first()).toBeVisible()
})
```

---

## 9. Styling and layout

| ID | Rule | F/A | Source |
|---|---|---|---|
| UI-1 | Styles live in stylesheets, not inline `style` objects. A `style` attribute holds declarations only, so it cannot carry a media query, `:hover` or `:focus` | F | [W3C: CSS style attributes](https://www.w3.org/TR/css-style-attr/) (inferred from the spec; no page states it outright) |
| UI-2 | One styling system per repo: CSS Modules beside the component, or Tailwind | A. Decide the system | House |
| UI-3 | Write for the narrow screen first and widen with `min-width` or `width >=` queries | F | [MDN: responsive design](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Responsive_Design) |
| UI-4 | No horizontal scroll at 320 CSS pixels wide | F | [WCAG 1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow) |
| UI-5 | Images carry `width` and `height`, or `fill` inside a sized box | F | [Next: images](https://nextjs.org/docs/app/getting-started/images); [web.dev: optimize CLS](https://web.dev/articles/optimize-cls) |
| UI-6 | Use `next/image`. Remote hosts are listed in `images.remotePatterns`. The image above the fold gets `preload`; `priority` is deprecated from 16.0 | F | [Next: Image](https://nextjs.org/docs/app/api-reference/components/image) |
| UI-7 | Fonts load through `next/font`, which self-hosts them | F | [Next: fonts](https://nextjs.org/docs/app/getting-started/fonts) |
| UI-8 | A loading placeholder is the size of what replaces it | F | [web.dev: optimize CLS](https://web.dev/articles/optimize-cls) |
| UI-9 | A component renders correctly when its image is `null`, slow or refused | F | House. Third-party content fails |
| UI-10 | Respect `prefers-reduced-motion` and `prefers-color-scheme` | F | [MDN: prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion); [MDN: prefers-color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-color-scheme) |
| UI-11 | Every page exports `metadata` or `generateMetadata` with a real title and description | F | [Next: metadata](https://nextjs.org/docs/app/getting-started/metadata-and-og-images) |

---

## 10. Accessibility

Target: WCAG 2.2 level AA ([W3C Recommendation](https://www.w3.org/TR/2024/REC-WCAG22-20241212/)).

| ID | Rule | F/A | Source |
|---|---|---|---|
| A11Y-1 | Use the native element first: `<button>`, `<a>`, `<label>`, `<form>`. No ARIA is better than bad ARIA | F | [APG: read me first](https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/) |
| A11Y-2 | Every input has a visible `<label>`. A placeholder is not a label | F | [WCAG 3.3.2](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions); [MDN: label](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/label) |
| A11Y-3 | Every page has one `<main>`. Search forms use `role="search"` or `<search>` | F | [APG: landmark regions](https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/); [MDN: search](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/search) |
| A11Y-4 | One `<h1>` per page, and no skipped heading levels | F | [MDN: heading elements](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/Heading_Elements) |
| A11Y-5 | A set of results is a `<ul>` or `<ol>`. Structure shown visually exists in the markup | F | [WCAG 1.3.1](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships) |
| A11Y-6 | Every image has `alt`: a description, or empty when decorative | F | [WCAG 1.1.1](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content); [W3C: alt decision tree](https://www.w3.org/WAI/tutorials/images/decision-tree/) |
| A11Y-7 | An error renders in `role="alert"`, a loading or result-count message in `role="status"` | F | [WCAG 4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages); [MDN: alert](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/alert_role); [MDN: status](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role) |
| A11Y-8 | Everything works from the keyboard, and focus is always visible. Never `outline: none` without a replacement | F | [WCAG 2.1.1](https://www.w3.org/WAI/WCAG22/Understanding/keyboard); [WCAG 2.4.7](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) |
| A11Y-9 | Text contrast is at least 4.5:1, or 3:1 for large text. Check both colour schemes | F | [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) |
| A11Y-10 | Pointer targets are at least 24 by 24 CSS pixels | F | [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) |
| A11Y-11 | A custom control exposes its name, role and state. An icon-only button has an accessible name | F | [WCAG 4.1.2](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value) |
| A11Y-12 | A modal traps focus and returns it on close | F | House, from review. Keyboard access: [WCAG 2.1.1](https://www.w3.org/WAI/WCAG22/Understanding/keyboard) |
| A11Y-13 | An automated score is not a pass. Deque measured automated tests finding 57.38% of issues. Walk the page with a keyboard and a screen reader before sign-off | F | [Deque: automated testing coverage](https://www.deque.com/automated-accessibility-testing-coverage/); [web.dev: automated accessibility testing](https://web.dev/learn/accessibility/test-automated) |

The failures most often found on real pages are the basics: low-contrast text on 83.9% of home pages, missing alt text on 53.1%, missing form labels on 51% ([WebAIM Million 2026](https://webaim.org/projects/million/)).

---

## 11. Performance

| ID | Rule | F/A | Source |
|---|---|---|---|
| PERF-1 | Targets: LCP 2.5 s or less, INP 200 ms or less, CLS 0.1 or less, at the 75th percentile, on phone and desktop separately | F | [web.dev: Web Vitals](https://web.dev/articles/vitals) |
| PERF-2 | Field data decides priorities. Lighthouse is lab data and can disagree with what users get | F | [web.dev: lab and field data differences](https://web.dev/articles/lab-and-field-data-differences) |
| PERF-3 | The main content is in the server HTML. The LCP image is never lazy-loaded and is discoverable in the HTML | F | [web.dev: optimize LCP](https://web.dev/articles/optimize-lcp) |
| PERF-4 | Keep client JavaScript small: interactivity in leaves, heavy client-only parts behind `next/dynamic` | F | [Next: lazy loading](https://nextjs.org/docs/app/guides/lazy-loading); [web.dev: optimize INP](https://web.dev/articles/optimize-inp) |
| PERF-5 | Third-party scripts load through `next/script` with a stated strategy | F | [Next: scripts](https://nextjs.org/docs/app/guides/scripts) |
| PERF-6 | Check the bundle before adding a dependency and before release | A. Decide the analyzer | [Next: package bundling](https://nextjs.org/docs/app/guides/package-bundling) |
| PERF-7 | Do not memoize by hand without a measurement. An inline object or function prop defeats `React.memo` on the child | A with the compiler (STATE-14) | House, from review. The compiler's position: [React Compiler 1.0](https://react.dev/blog/2025/10/07/react-compiler-1) |
| PERF-8 | Walk the Next production checklist before launch | F | [Next: production checklist](https://nextjs.org/docs/app/guides/production-checklist) |

---

## 12. Security

| ID | Rule | F/A | Source |
|---|---|---|---|
| SEC-1 | A Server Action is a public POST endpoint. Each one checks authentication and authorization itself and validates its input. A check on the page does not cover it | F | [Next: data security](https://nextjs.org/docs/app/guides/data-security); [Next: server actions](https://nextjs.org/docs/app/guides/server-actions); [React: 'use server'](https://react.dev/reference/rsc/use-server) |
| SEC-2 | Route Handlers are public endpoints with the same duty | F | [Next: backend for frontend](https://nextjs.org/docs/app/guides/backend-for-frontend) |
| SEC-3 | Authorization compares the caller to the row being read or changed. Role and price are re-derived on the server, never taken from the request | F | [OWASP Top 10 2025: A01 Broken Access Control](https://owasp.org/Top10/A01_2025-Broken_Access_Control/) |
| SEC-4 | Data access goes through a Data Access Layer that returns minimal objects. Actions never return a raw database record | F for new projects | [Next: data security](https://nextjs.org/docs/app/guides/data-security) |
| SEC-5 | Validate every form and JSON body on the server with a schema, even when the browser checks the same fields | F | [OWASP: input validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html) |
| SEC-6 | No `dangerouslySetInnerHTML` with content that is not fully trusted or sanitized | F | [React: dangerously setting the inner HTML](https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html); [OWASP: XSS prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html) |
| SEC-7 | A server route that fetches a caller-supplied URL or id validates it against an allowlist | F | [OWASP: SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) |
| SEC-8 | Proxy (middleware) is never the only authorization check | F | [GHSA-f82v-jwr5-mffw](https://github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw) |
| SEC-9 | Run a supported, patched release and read the framework's security posts. Dependencies with a known advisory and an available fix block the merge | F | [OWASP Top 10 2025](https://owasp.org/Top10/2025/); [Next: September 2026 security release](https://nextjs.org/blog/september-2026-security-release) |
| SEC-10 | Ship a Content Security Policy, report-only first | A. Decide the policy | [Next: CSP](https://nextjs.org/docs/app/guides/content-security-policy); [MDN: CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) |
| SEC-11 | Session tokens live in `httpOnly`, `Secure`, `SameSite` cookies, not `localStorage`. No secrets, tokens or personal data in logs, URLs or analytics | F | House, from review |
| SEC-12 | New packages are reviewed for install scripts, size and an existing alternative. Third-party CI actions are pinned | F | [OWASP Top 10 2025](https://owasp.org/Top10/2025/) (A03 Software Supply Chain Failures) |

| Advisory | What | Fixed in |
|---|---|---|
| [CVE-2025-29927](https://github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw) | Authorization checks in middleware could be bypassed | Next 15.2.3, 14.2.25, 13.5.9, 12.3.5 |
| [CVE-2025-55182](https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components), tracked for Next as [CVE-2025-66478](https://nextjs.org/blog/CVE-2025-66478) | Unauthenticated remote code execution through Server Function payloads | React 19.0.1, 19.1.2, 19.2.1; Next 15.0.5, 15.1.9, 15.2.6, 15.3.6, 15.4.8, 15.5.7, 16.0.7 |
| [September 2026 releases](https://nextjs.org/blog/september-2026-security-release) | Latest patched lines | Next 16.3.8 (Active LTS), 15.5.27 (Maintenance LTS) |

---

## 13. Review scan order

For reading someone else's component, in this order. Each line is a section above.

1. **Boundary:** is `'use client'` on a leaf? What crosses to the client? (3)
2. **Data:** where is it fetched, is `ok` checked, is the shape parsed, is anything per-user cached? (4)
3. **Decisions:** which `if`, `filter`, `sort` or string-building sits in a component or effect? (1)
4. **State:** count the `useState` calls. Which can be derived? Which can disagree? (6)
5. **Effects:** cleanup, and is it reacting to an event that has a handler? (6)
6. **Lists:** keys, mutation, pagination (6, 4)
7. **Types:** `any`, casts, `!`, nullable fields (7)
8. **Markup:** label, landmark, heading, list, alt, live region (10)
9. **Layout:** sizes reserved, narrow screen, inline styles (9)
10. **Tests:** does each new branch have one, and can it fail? (8)
11. **Server entry points:** auth and validation in every action and route (12)

A finding needs a consequence in this codebase and a source: name the input that goes wrong, or give a count ([Google: the standard of code review](https://google.github.io/eng-practices/review/reviewer/standard.html)).

---

## 14. How this was checked, and what was not

| Item | Status |
|---|---|
| Next.js links (37 pages) | Every claim read in the local Next 16.3.8 docs (`node_modules/next/dist/docs/`). Four public pages fetched and matched; the rest returned HTTP 200 |
| React, tooling and web-standards links | Each page fetched on 2026-10-06. The fetch tool returns a summary, so this guide paraphrases and does not quote them. Check the wording on the page before quoting any in a review |
| Worked example | Typecheck, lint and 8 unit tests pass (versions in section 1). `next build`, the component test and the Playwright test were not run |
| Tool versions in the wild | Docs fetched show Vitest 5.0.3, ESLint 10.12.0, TypeScript 7.0.x, React 19.3.0. The example ran on Vitest 1.2.1, ESLint 9.39.5 and TypeScript 5.9.3, the versions installed locally |
| UI-1 | No page says outright that inline styles cannot hold media queries or pseudo-classes. It follows from the spec's definition |
| ARCH-1 | Bernhardt's talk page was read; "decisions in pure functions, I/O in a thin shell" is my paraphrase of it |
| ARCH-7 | The Bulletproof React fetch summary contradicted itself on cross-feature imports. Read the doc before quoting its import rule |
| TEST-4 | The user-event page explains the difference from `fireEvent`. An explicit "we recommend" sentence was not confirmed |
| React docs on testing | react.dev has no testing page. It says only that a reducer can be tested in isolation. Do not cite React for "pure components are easier to test" |
| Lighthouse | The sentence that Lighthouse detects only a subset of accessibility issues was not found on the Chrome scoring page. A11Y-13 cites Deque and web.dev instead |
| `next: { revalidate }` under `cacheComponents: true` | Not checked |
| Rules marked "House" | 36 of 156. From reviews. No outside source says them in those words |

## Not covered yet

React Native and Expo, design system and tokens, observability and analytics, internationalization, authentication flows, rollout and feature flags.
