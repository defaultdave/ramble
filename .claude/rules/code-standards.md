---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.mjs"
  - "**/*.cjs"
---
# Code Standards

Shared standards for all agents. Agent-specific rules live on individual agent definitions.

This file is the short form. The full rule set, with an id, a source, and a fixed-or-adapts marker on every rule, is `$CLAUDE_PROJECT_DIR/.claude/vig/standards/react-nextjs.md`; read the sections that match the work. A project's `.claude/standards/stack-decisions.md` settles the rules that adapt per project.

## Documentation

- **README.md** — Every project must have one. Include: what it does, how to install, how to run, how to test.
- **CLAUDE.md** — Every project must have one. Include `## Tooling` section with tech stack and dev commands.
- **TSDoc** — All exported functions, interfaces, and types get TSDoc comments. Include `@param`, `@returns`, `@throws` where applicable. Internal helpers don't need docs unless complex.
- **Module-level docs** — Files over 80 lines or with non-obvious control flow get a doc comment at the top explaining purpose and structure.
- **Docs currency** — If a change adds, removes, or renames a user-facing surface (a slash command, an agent, a rule, or a shipped/planned phase status), `README.md` and `CLAUDE.md` MUST be updated in the same PR to reflect it. tech-pm lists them in `in_scope_globs:`; review enforces on the diff. Internal refactors and bug fixes are exempt.

## Structure

Write code so a unit test can reach every decision in it.

- **Logic in pure functions.** Every decision (filter, sort, parse, format, build a URL, pick which state to show) is a named function that takes values and returns a value, in a module its caller imports. No decision sits inline in JSX, an effect, or a route handler.
- **I/O at the edge.** One module per external service owns its base URL, headers, response type, and error mapping. Nothing else calls `fetch` against that service.
- **Async shells stay thin.** An async Server Component, route handler, or effect reads its input, awaits the service module, and passes the result on. If a branch in it needs a unit test, move the branch into a function.
- **Components render props.** A component is synchronous: props in, markup out. It does not fetch.
- **Imports point one way.** Route files import components, components import `lib/`, and nothing imports back up. A lint rule enforces it.
- **Third-party SDKs sit behind a wrapper module.** Components import the wrapper, never the analytics, monitoring, or feature-flag SDK.
- **Errors propagate.** No `catch` that returns `undefined` in a helper or service module.
- **Test each layer with the cheapest tool that reaches it.** Pure functions get unit tests. Synchronous components get component tests. Each async shell gets one end-to-end test, because a unit runner cannot render it.
- **One layout rule per repo.** Routes live in the framework's route folder and nothing else does; `components/` and `lib/` are lowercase; a file is named for its main export; imports use the configured path alias.

## Types

- **Shared types in a dedicated file.** If a type is used across 2+ files, define it in `src/types.ts` (or equivalent) and export it. Never repeat inline union literals across files.
- **Interfaces over inline types** for any shape used in more than one function.
- **No `any`** — use specific types. If you must use `unknown`, narrow it.
- **External data is typed as returned.** A field the API can send as `null` is typed nullable. No `as` cast on a parsed response: validate or narrow it at the boundary.
- **One name per thing.** Reuse an existing type instead of redeclaring its fields. Name a type for the domain object it describes. Never shadow a global (`Response`, `Error`, `Event`).
- **No escape hatches without a reason.** No non-null `!` on a lookup. A `@ts-ignore` or `@ts-expect-error` carries its reason on the same line.
- **`import type` for type-only imports. `??` for a default where `0`, `''`, or `false` is a valid value.**

## Tests

- **DRY test code.** Extract shared setup into helper functions or `beforeEach`. If multiple tests need the same setup, that's a helper, not copy-paste.
- **Shared fixtures** — Define test data constants once, reuse across describe blocks.
- **Meaningful assertions** — Test behavior, not implementation. Assert on outputs and side effects, not internal state.
- **Edge cases proportional to complexity** — Simple functions need happy path + error path. Complex logic needs boundary conditions.
- **Tests sit beside the file they cover.** `artworks.ts` and `artworks.test.ts` share a folder. No placeholder tests.
- **One test per behaviour, not per line.** Write the list of behaviours first, one line per decision, branch, or risk, and write one test per line. Cases that exercise the same branch share one `it.each` table.
- **Cover each branch once, at the cheapest layer.** A branch a unit test covers is not tested again in the component test or the end-to-end test.
- **A fix ships with a test that fails without it.** Check by breaking the line and rerunning.
- **Mocks cover failure (4xx, 5xx, timeout) and match the real API's shape.** No `.only`, `.skip`, or `.todo` is merged.
- **Query by role and accessible name** in component tests (`getByRole('searchbox', { name: /search/i })`), so a missing label fails the test.

## Code Quality

- **No dead code.** Remove unused imports, variables, and functions. Don't comment out code "for later."
- **Consistent error handling.** Use the same pattern within a project (throw errors, return Result types, etc.). Error messages must be descriptive and include relevant IDs/context.
- **Exit codes.** CLI tools: 0 for success, 1 for errors. Write to stderr for errors, stdout for normal output.
- **Build URLs with `URL` and `URLSearchParams`.** Never interpolate input into a URL string.
- **Check `response.ok` before parsing.** `fetch` resolves on 4xx and 5xx. Throw on a non-2xx response and put the status in the message.
- **Never mutate an argument, prop, or state value.** Copy before `sort`, `reverse`, or `splice`.
- **`===` only, and no side effect inside an expression.** `cond && doThing()` as a statement becomes an `if`.
- **One async style per function.** `await`, not `.then` chains inside an `async` function.
- **Read it, don't hardcode it.** A value the API or config supplies (a base URL, a page size) is read from there. Any other literal that carries meaning is a named constant.
- **Comments say why.** Delete a comment that restates the next line. A lint suppression carries its reason.

## Tooling

- **A configured tool has a script and runs in CI.** A formatter or linter listed in `package.json` that nothing runs is dead config.
- **Scripts.** `test` is one-shot (`vitest run`, not watch mode), with `typecheck`, `lint`, and `format` beside it.
- **Lint catches what review should not have to.** typescript-eslint's recommended set plus `eqeqeq`.
- **Test and build tooling goes in `devDependencies`.** The test environment can render what the project ships (a DOM environment for components).

## Web UI

- **Interactive, not display-only.** If the app has CRUD operations, users must be able to perform ALL of them through the UI. A view page without a create form is incomplete.
- **XSS protection.** Escape all user-supplied strings rendered in HTML. Use a shared `escapeHtml()` utility.
- **Semantic HTML.** Use appropriate elements (forms, buttons, labels, headings). Accessibility matters.
- **Label, landmark, heading, list.** Every input has a `<label>`. Every page has one `<main>` and one `<h1>`. A set of results is a `<ul>`. An error renders in `role="alert"` and a loading state in `role="status"`.
- **An automated accessibility score is not a pass.** Walk the page with a keyboard and a screen reader before sign-off.
- **Styles live in stylesheets.** No inline `style` objects. A CSS module sits beside its component, written for the narrow screen first with `min-width` queries.
- **Reserve space.** An image carries `width` and `height`. A loading placeholder is the size of what replaces it.
- **Remote content can be absent.** A component renders correctly when its image is `null`, slow, or refused.
- **Judge performance on field data.** LCP 2.5 s or less, INP 200 ms or less, CLS 0.1 or less, at the 75th percentile. A Lighthouse score is lab data.

## React and Next.js

- **Server first.** In the App Router, data is fetched in a Server Component. `'use client'` goes on the smallest component that needs state or an event handler.
- **Shareable state lives in the URL.** A search term, filter, or page number is a query parameter, submitted by a native `<form>` and read from `searchParams`.
- **Route files own loading and error states.** `loading.tsx` and `error.tsx`, not hand-written flags.
- **One state value per fact.** A request's status is one discriminated union, not parallel `isLoading`, `error`, and `data` flags. A value that can be computed during render is not stored.
- **An effect that fetches has a cleanup that aborts the request.** A user action triggers the fetch, not a change in a state value.
- **Keys are stable ids.** Never the array index on a list that sorts, filters, or grows.
- **A server-side fetch to a rate-limited API sets a cache lifetime.** Every visitor shares the server's IP.
- **Mutations are Server Actions passed to `<form action>`.** An expected failure is a return value read with `useActionState`; an unexpected one throws to `error.tsx`.
- **A module that touches the database or a secret starts with `import 'server-only'`.**

## Security

- **Every Server Action and Route Handler is a public endpoint.** Each one checks who is calling, compares that caller to the row being read or changed, and validates its input with a schema. A check on the page or in middleware does not cover it.
- **Secrets stay on the server.** No secret in a `NEXT_PUBLIC_` variable, a log line, a URL, or `localStorage`. Session tokens live in `httpOnly`, `Secure`, `SameSite` cookies.
- **Environment variables are read and validated once,** in one module, at start-up.
- **Stay on a patched framework release.** A dependency with a known advisory and an available fix blocks the merge.

> See [docs/rules/code-standards.md](../../docs/rules/code-standards.md) for rationale and history.
