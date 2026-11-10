# Example: Bookmarks on a content app

A user-facing feature where the easy default is a layered cut (model → API → UI) and the better cut is a walking skeleton — piece 1 ships an end-to-end thin slice, validating the data path and UI placement before investing in breadth. Use this as a template when the architecture is new, demoability matters, and subsequent pieces need a baseline to stack on.

## Input the user provided

> "We want users to be able to bookmark articles in our content app. Logged-in users only. Need to add and remove bookmarks. Eventually want a 'My Bookmarks' page with sorting, but for v1 just need to see them somewhere. Backend can add a `bookmarks` table; frontend should show a button on each article."

## Clarifying questions the skill asked

1. For v1, where do bookmarks show up after a user adds one — a dedicated page, an inline list in the article header, or somewhere in the user's profile? Affects whether piece 1 ships a list view or just the toggle.
2. Should bookmarking be optimistic (instant UI feedback, rollback on failure) or wait-for-server? The first is more polished but doubles piece 1's surface.

User answered: "Dedicated `/bookmarks` page is fine, simple list. Optimistic UI is nice-to-have, defer to a later piece."

## Plan produced

# Decomposition Plan: Article bookmarking

## Goal
Logged-in users can bookmark and unbookmark articles, and see their bookmarks on a dedicated `/bookmarks` page.

## Cut rationale
Three pieces, walking-skeleton style. Piece 1 ships a thin end-to-end slice — bookmark toggle plus list view, real DB write, real auth — so the team validates the data path, the auth wiring, and the placement of the toggle against real infrastructure before investing in the rest. Pieces 2 and 3 layer in polish (optimistic UI, sort + empty-state) on top of the validated foundation. Considered a layered cut (schema → API → UI as three pieces) — rejected because piece 1 would have been schema-only with nothing demoable, and the UI piece would have been an unreviewable diff that has to absorb any backend surprises.

## Out of scope
- Folders or tags on bookmarks
- Sharing bookmarks with other users
- Email notifications when a bookmarked article updates
- Mobile app changes (web only)

## Pieces

### 1. Walking skeleton: toggle + simple list
- **Scope.** New `bookmarks` table with `id, user_id, article_id, created_at`. New `POST /articles/:id/bookmark` and `DELETE /articles/:id/bookmark` endpoints. New `GET /me/bookmarks` returning a chronological list. Bookmark toggle button on each article view; new `/bookmarks` page renders the list with title and date. Wait-for-server feedback (no optimistic UI yet).
- **Depends on.** None.
- **Rough size.** M.
- **Reviewability.** Yes — wide diff, but the surface is intentionally thin: one table, one endpoint trio, one button, one list page.
- **Open questions.** None.

### 2. Optimistic UI on the toggle
- **Scope.** Bookmark toggle becomes optimistic — instant on/off feedback, rollback if the server returns an error, error toast on rollback.
- **Depends on.** Piece 1.
- **Rough size.** S.
- **Reviewability.** Yes — bounded surface, builds on piece 1's seam.
- **Open questions.** Should the error toast offer a retry, or just show the rollback? Defaulting to no retry; user can click again.

### 3. Sort + empty state on /bookmarks
- **Scope.** Add sort options (newest first, oldest first, alphabetical by title) to `/bookmarks`. Polish empty state with copy and a CTA back to the article list. Add loading skeleton to the list.
- **Depends on.** Piece 1. Independent of piece 2.
- **Rough size.** S.
- **Reviewability.** Yes — additive on top of piece 1's list page.
- **Open questions.** None.

## Implementation order
- **Cut strategy.** Walking skeleton. Considered layered (schema → API → UI as three pieces) — rejected because piece 1 would have been schema-only with nothing demoable, and the UI piece would have been too large to review while also having to absorb any backend surprises.
- **Baseline piece.** Piece 1 — pieces 2 and 3 both stack on it.
- **Parallel-eligible pieces.** Pieces 2 and 3 stack on piece 1's branch and run as concurrent squads as soon as piece 1's branch exists (no need to wait for the PR to merge). They share piece 1's seams (the toggle component, the list page) but have no logical dependency on each other.
- **Merge-conflict hotspots.** Piece 2 modifies the toggle component; piece 3 modifies the list page — distinct files, no conflict expected. If both pieces revise piece 1's API typings, that single shared file becomes a mechanical (additive) overlap — flag the second-to-merge to rebase rather than serializing the work.
- **Invocation.** `/team <piece-1-id>` first. As soon as piece 1's branch exists (open PR is fine — no need to wait for merge): `/foreman start <repo> <piece-2-id> <piece-3-id> --base <piece-1-branch>`.

## Uncertainty
- The plan assumes auth wiring already attaches a `user_id` to authenticated requests. If not, piece 1 grows to include that wiring and "M" is closer to L.
- "Optimistic UI" in piece 2 assumes a client-side cache for bookmark state. If not, piece 2 falls back to a refresh-after-mutation pattern — same outcome, simpler code.

## Acknowledgment
Reply with "go" to proceed, or tell me what to change about the cut, the order, or the strategy. Once the three tickets are filed, start with `/team <piece-1-id>`. As soon as that branch exists (open PR is fine — no need to wait for merge), run `/foreman start <repo> <piece-2-id> <piece-3-id> --base <piece-1-branch>` to put pieces 2 and 3 in flight stacked on top of it.
