# ADR 0009: Cat Pass salvage

- **Status:** Accepted 2026-10-18 (Dave), as recommended (clean build).
- **Date:** 2026-10-18
- **Question:** R9 in `docs/plan/BUILD-PLAN.md`

## Context

Cat Pass (`~/Workspace/cat-pass-prototype`) is an earlier marketplace prototype and the closest prior art. Checked 2026-10-18:

- Next.js App Router, 13 commits, last on 2026-03-12.
- About 70 source files and 4,400 lines under `src/`, 14 test files (Vitest and Playwright).
- Libraries: Tailwind with Radix primitives in a generated component style, a translation library with a locale segment in every route, a URL-state library, a server-action wrapper, TanStack Query, Zustand, and two schema libraries (Valibot and Zod).
- Its package name and build plan still carry the prior client's framing.

The build plan's rule: prior client work is evidence, never a template. No names, URLs, copy, URL shapes, or architecture language lifted from it. The project's purpose is to prove a planning method, so the estimate's actuals have to reflect building Ramble.

## Driving requirements

| ID or rule | Why it matters here |
|---|---|
| BUILD-PLAN standing rules | Prior client work is evidence, not a template |
| BUILD-PLAN P4, P6 | Frozen estimate and the delta writeup need honest actuals |
| PRD-63 | Ramble's own address scheme; no inherited URL shapes, including a locale segment nobody asked for |
| PRD-68, PRD-69 | The quality bar is Dave's current standards, which postdate Cat Pass |

## Options

**A. Clean build; Cat Pass as reference only.** Agents may read it for patterns (scope discipline rule 3: reference code is a style guide) but copy nothing.
- Fit: clean framing, actuals that mean something, and code written to the current standards from the start.
- Cost: no head start.

**B. Strip pass, then lift specific modules** (for example its data layer, URL-state search, or checkout form). A strip unit removes framing and renames first.
- Fit: saves some days on the modules lifted.
- Risk: framing leaks through names, copy, and route shapes; its library mix conflicts with the standards (two schema libraries, a client store, a client data cache where DATA-13 says none is needed); lifted units distort actuals unless each lift is its own logged unit.

**C. Fork Cat Pass and rename.**
- Fastest start, worst on every other count: inherited framing, inherited dependencies, and a plan whose actuals measure a rename.

## Recommendation

**A.** Build clean. Cat Pass is open for reading, and any pattern borrowed is rewritten to the standards. Nothing is copied.

## What would change the call

- The P4 estimate misses December 1 by a margin that a specific lift would close: scope that lift as its own unit, with a strip pass and its own actuals, and record the departure in the delta log.
