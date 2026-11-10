# Example: Avatar component consolidation

A cross-cutting refactor where the work touches multiple existing surfaces and the cut is shaped by what's safe to ship incrementally. Use this as a template for refactors, migrations, or anything where "the work is everywhere."

## Input the user provided

> "We have four different `Avatar` implementations across the app — header, comments, profile page, and settings. They look slightly different and have inconsistent props. We want one canonical Avatar component with size and shape variants. Settings has a 'change avatar' affordance that the others don't — that should stay only on settings."

## Clarifying questions the skill asked

1. Is the goal one component with variant props (e.g., `size`, `shape`, `editable`), or one component that settings composes with an extra editable wrapper?
2. Are the visual differences across the four current implementations intentional, or accidental drift that should converge on a single design?

User answered: "Variant props. Visual differences are accidental drift — converge on the design system spec for size and shape."

## Plan produced

# Decomposition Plan: Consolidate Avatar usages

## Goal
One canonical `Avatar` component with `size` and `shape` variants replaces all four current implementations across the app. Settings keeps the 'change avatar' affordance via an `editable` prop.

## Cut rationale
Five pieces. Piece 1 establishes the unified component behind a feature flag, which lets each migration ship independently without breaking existing surfaces. Each migration is its own piece because each surface has its own QA path, its own risk profile, and its own reviewer. The settings migration ships last because it's the divergent case (`editable` prop) and benefits from seeing the component stabilize against the simpler usages first. Deletion of the old implementations and removal of the flag attach to the final piece. Considered a single "migrate everything" piece — rejected because a regression in any one surface would block all four; considered a separate "delete old code" piece — rejected because once all four have migrated, the deletion is a one-line change per surface and bundles cleanly into piece 5.

## Out of scope
- Visual redesigns of the Avatar (we're converging on the design system spec, not redesigning it)
- Changes to the parent layouts surrounding any Avatar usage
- Loading or error placeholder behavior beyond what each current implementation already does

## Pieces

### 1. New unified Avatar behind feature flag
- **Scope.** Create the new `<Avatar size="..." shape="..." editable={...} />` component matching the design system spec. The four old implementations stay in place; nothing currently uses the new one. Behind an `avatar-v2` feature flag for safety, even though no consumers exist yet.
- **Depends on.** None.
- **Rough size.** M.
- **Reviewability.** Yes — purely additive, no consumer changes.
- **Open questions.** Final variant prop names (`size: "sm" | "md" | "lg"` vs. numeric pixel values). Can iterate without affecting other pieces because nothing consumes it yet.

### 2. Migrate header Avatar
- **Scope.** Header imports the new Avatar instead of the old one. Old implementation file remains.
- **Depends on.** Piece 1.
- **Rough size.** S.
- **Reviewability.** Yes — single-surface consumer change.
- **Open questions.** None.

### 3. Migrate comments Avatar
- **Scope.** Same shape as piece 2, comments surface.
- **Depends on.** Piece 1. Independent of piece 2.
- **Rough size.** S.
- **Reviewability.** Yes.
- **Open questions.** None.

### 4. Migrate profile page Avatar
- **Scope.** Same shape as piece 2, profile page surface.
- **Depends on.** Piece 1. Independent of pieces 2 and 3.
- **Rough size.** S.
- **Reviewability.** Yes.
- **Open questions.** None.

### 5. Migrate settings Avatar + delete old implementations + remove flag
- **Scope.** Settings imports the new Avatar with `editable`. The four old implementation files are deleted. The `avatar-v2` feature flag is removed from config and any feature-flag check sites.
- **Depends on.** Pieces 1–4.
- **Rough size.** M.
- **Reviewability.** With caveat — deletion plus the settings migration in one diff is wider than the others. Consider splitting into 5a (settings migration) and 5b (delete old + remove flag) if the diff feels unreviewable in practice.
- **Open questions.** What's the acceptable test coverage before removing the flag?

## Implementation order
- **Cut strategy.** Layered with feature-flag scaffolding. Considered walking skeleton — rejected because there's no end-to-end user flow to slice (this is a code consolidation, not a feature). Piece 1 establishes the foundation; the migrations stack on it.
- **Baseline piece.** Piece 1 — every migration stacks on it.
- **Parallel-eligible pieces.** Pieces 2, 3, and 4 stack on piece 1's branch and run as concurrent squads as soon as piece 1's branch exists (no need to wait for the PR to merge). Each touches a distinct surface (header, comments, profile). Piece 5 serializes after all three.
- **Merge-conflict hotspots.** Pieces 2–4 touch distinct files — no conflict expected. Piece 5 collides with piece 1's component file when removing the old implementations and the flag, and may also touch any feature-flag check sites the migration pieces added — semantic conflict, must be sequenced last.
- **Invocation.** `/team <piece-1-id>` first. As soon as piece 1's branch exists (open PR is fine — no need to wait for merge): `/foreman start <repo> <piece-2-id> <piece-3-id> <piece-4-id> --base <piece-1-branch>` to fan out the migrations. After all three land: `/team <piece-5-id> --base <piece-1-branch>`.

## Uncertainty
- The plan assumes the new Avatar can express all needed variants without divergent settings behavior. If during piece 1 the `editable` API gets ugly, the cut between "shared component with variants" and "separate editable wrapper" may need to be reconsidered.
- Pieces 2–4 are listed as independent, but if the migrations reveal surface-specific bugs, that's a signal the variant API isn't right and piece 1 needs revision.

## Acknowledgment
Reply with "go" to proceed, or tell me what to change. Once the five tickets are filed, start with `/team <piece-1-id>`. As soon as that branch exists (open PR is fine — no need to wait for merge), run `/foreman start <repo> <piece-2-id> <piece-3-id> <piece-4-id> --base <piece-1-branch>` to put the three migration squads in flight in parallel. After all three land, run `/team <piece-5-id> --base <piece-1-branch>` for the final settings migration and cleanup.
