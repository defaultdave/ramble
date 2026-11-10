# Example: Trending tags sidebar widget

A small visual feature with a data dependency where a layered cut produces clean, parallel-eligible pieces. Use this as a template for plans where the work is mostly visual but has a real backend touchpoint.

## Input the user provided

> "We want a 'Trending Tags' widget on the right sidebar of the homepage. Figma here: [link]. Should show top 10 tags by usage in the last 7 days, clickable to filter the homepage feed by that tag. We have a `/api/tags` endpoint that returns all tags with usage counts, but I'm not sure it has the time-window filter we need."

## Clarifying questions the skill asked

1. The Figma frame shows a vertical list of 10 tags with counts. Is the count fixed at 10, or driven by what the API returns?
2. The endpoint may not have a time-window filter. Should I plan for a small backend change (add a `?since=` parameter) or for client-side filtering of the full result?

User answered: "Fixed at 10 max. Backend change is fine — they have bandwidth — but make it a separate piece so we don't block the frontend on it."

## Plan produced

# Decomposition Plan: Trending tags sidebar widget

## Goal
Homepage visitors see the top 10 trending tags from the past 7 days in the right sidebar, with each tag clickable to filter the feed by that tag.

## Cut rationale
Three pieces. Piece 1 (backend) adds the time-window filter to `/api/tags` and is independent of frontend work. Piece 2 (frontend) builds the presentational component against a typed contract that piece 1 will satisfy. Piece 3 wires them together on the homepage. Considered shipping the component and integration as one piece — rejected because the component is reusable on other pages (e.g., search results) and the seam is real. Considered walking skeleton (a hardcoded widget directly on the homepage) — rejected because the feature is small enough that the layered cut produces three S-sized pieces with clean seams; a walking skeleton would have collapsed everything into one piece padded with stubs.

## Out of scope
- Trending-tag aggregation logic beyond the time window (e.g., recency weighting, near-duplicate dedup)
- Caching strategy for the endpoint
- Mobile responsive variations not in the Figma frame
- A "see all tags" page

## Pieces

### 1. Backend: time-window filter on /api/tags
- **Scope.** Extend `/api/tags` to accept `?since=<ISO8601>` and `?limit=<n>`. Returns tags with usage counts within that window, capped at the limit. Existing callers without the parameters get unchanged behavior.
- **Depends on.** None.
- **Rough size.** S.
- **Reviewability.** Yes — small additive change to one endpoint.
- **Open questions.** None.

### 2. Presentational TrendingTags component
- **Scope.** A `<TrendingTags tags={...} onTagClick={...} />` component matching the Figma frame. Renders a vertical list of tags with counts. No data fetching, no business logic. Includes loading skeleton and empty state (returns null if `tags` is empty).
- **Depends on.** None — accepts props.
- **Rough size.** S.
- **Reviewability.** Yes — reviewable against the Figma frame directly, no app integration needed.
- **Open questions.** None.

### 3. Homepage sidebar integration
- **Scope.** Mount `<TrendingTags />` in the homepage sidebar. Fetch from `/api/tags?since=<7-days-ago>&limit=10` via a `useTrendingTags` hook. Tag click filters the homepage feed by that tag (re-uses the existing tag-filter mechanism).
- **Depends on.** Pieces 1 and 2.
- **Rough size.** S.
- **Reviewability.** Yes — small composition diff on the homepage layout.
- **Open questions.** None.

## Implementation order
- **Cut strategy.** Layered. Considered walking skeleton (hardcoded widget on the homepage) — rejected because the layered cut produces three S-sized pieces with clean seams and no shared files; the walking skeleton would have been one larger piece padded with stubs.
- **Baseline piece.** n/a — pieces 1 and 2 are independent and piece 3 depends on both.
- **Parallel-eligible pieces.** Pieces 1 (backend) and 2 (frontend component) run as concurrent squads from the start — they branch from `main` and touch disjoint directories. Piece 3 serializes after both.
- **Merge-conflict hotspots.** None — each piece touches a distinct directory (backend route, frontend component, homepage layout).
- **Invocation.** `/foreman start <repo> <piece-1-id> <piece-2-id>` to spawn pieces 1 and 2 in parallel from `main`. After both land: `/team <piece-3-id>` for the integration.

## Uncertainty
- The plan assumes the existing `useTagFilter` mechanism on the homepage feed accepts a tag programmatically. If it only responds to URL state, piece 3 grows slightly to push to URL state on click — same outcome, slightly bigger diff.
- Piece 1 assumes the existing `/api/tags` query can express usage counts efficiently with a time window. If the backing query is expensive at the 7-day window, piece 1 may spawn a follow-up performance ticket — out of scope for this plan.

## Acknowledgment
Reply with "go" to proceed, or tell me what to change. Once the three tickets are filed, run `/foreman start <repo> <piece-1-id> <piece-2-id>` to put pieces 1 and 2 in flight in parallel from `main`. After both land, run `/team <piece-3-id>` for the integration.
