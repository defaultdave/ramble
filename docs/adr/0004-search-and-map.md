# ADR 0004: Search, filters, and map

- **Status:** Accepted 2026-10-18 (Dave), as recommended.
- **Date:** 2026-10-18
- **Question:** R4 in `docs/plan/BUILD-PLAN.md`
- **Depends on:** ADR 0001 (framework), ADR 0002 (data store)

## Context

Guests browse about 400 experiences at the 90-day target (G1), filter by category, neighborhood, and date, and land on indexable category and neighborhood pages from search engines. A map is not in launch scope. The catalog is small enough that search is a query, not an infrastructure problem.

## Driving requirements

| ID | Why it matters here |
|---|---|
| PRD-02 | Browse and filter by category, neighborhood, and date |
| PRD-05 | Zero results must offer a way forward |
| PRD-06 | More filters (Should): price, age, indoor or outdoor, group size, wheelchair access |
| PRD-07 | Keyword search (Should) |
| PRD-08 | Map view is Later |
| PRD-58 | Attribution parameters arrive on the same URLs as filters |
| PRD-65 | Category, neighborhood, and Picks pages are indexable with editorial copy |
| PRD-68, PRD-70 | Fast on phones, including under newsletter spikes |

## Options

**A. Server-side filtering in the data layer, URL as state.** Filters are query parameters (standards FORM-1, rule 4 of the 12 that matter). A Server Component reads them, validates them with a schema, and asks the data layer for matching experiences and sessions. Category and neighborhood landing pages are routes that run the same query with editorial copy on top. Keyword search, when PRD-07 ships, uses the database's own text search.
- Fit: every filter state has a shareable, indexable URL; no catalog shipped to the browser; results render in the server HTML (PERF-3).
- Cost: none beyond the data layer.
- Risk: each filter change is a server round trip. On a phone that is fine for 400 items if the query and page are cached sensibly (DATA-10 in ADR 0001).

**B. Client-side filtering.** Ship the catalog as JSON and filter in a client island.
- Fit: instant filter changes.
- Cost and risk: sends hundreds of records to every phone, which works against PRD-68 (LCP and INP) and PERF-4. URL state still has to be synced by hand. Indexable pages still need server rendering, so the logic is written twice.

**C. A hosted search service** (Algolia, Typesense Cloud, Meilisearch Cloud).
- Fit: typo tolerance, facets, and instant search out of the box.
- Cost and risk: another vendor and wrapper (ARCH-8), a sync pipeline from the database, and a monthly bill, for a catalog that a single query handles. Worth it at multi-city scale, not at launch.

**Map, for when PRD-08 is scheduled:** a static map image per experience (cheapest), MapLibre GL with a low-cost tile provider (interactive, open source), or Mapbox or Google Maps (richer, metered). Any interactive map loads with `next/dynamic` after interaction so it never touches LCP.

## Recommendation

**A.** Server-side filtering with the URL as state. Category and neighborhood pages are the same query with editorial copy. Keyword search uses the database's text search when PRD-07 is scheduled. No map at launch; the experience page shows the neighborhood and meeting point as text with a link that opens the guest's map app [proposed]. When PRD-08 is scheduled, MapLibre GL behind interaction.

Filter logic (which sessions match a date range, which experiences match age or access filters) lives in plain functions in `lib/` with unit tests (ARCH-1). Zero-results suggestions (PRD-05) are a plain function too.

## What would change the call

- The catalog passes a few thousand experiences, or a second city launches: revisit C.
- Keyword search needs typo tolerance or synonyms that database text search handles badly: Typesense or Meilisearch behind a wrapper.
- PRD-08 moves into launch scope: choose the map provider then.
