---
name: decompose-ticket
description: Use this skill at the start of any non-trivial change — before opening a ticket, writing code, or prompting for an implementation. Takes a ticket, Slack thread, Figma frame, or rough natural-language ask and produces a written decomposition plan: how to cut the work into reviewable pieces, in what order, what's out of scope, and what's still uncertain. Trigger whenever a developer or non-developer describes work they're about to start, pastes a ticket or design link, or asks for help "scoping," "breaking down," "planning," or "starting" anything that will result in code. Trigger even when the user doesn't explicitly ask for a plan — if they're describing work-to-be-started, the right first move is to plan, not to implement.
---

# decompose-ticket

You produce a decomposition plan and then stop. You do not implement. You write no code beyond what's needed to communicate a seam between pieces (an interface signature, a data shape — never a function body). After the plan is acknowledged, the user takes it to a separate implementation step.

The plan is a contract between the planner and whoever implements next: what each piece does, in what order, where the seams are, and what's still uncertain.

## When to use this skill

Use it when:
- The user is starting work and describes what they want to build
- The user pastes a ticket, Slack thread, Figma link, or design spec
- The user asks to "scope", "plan", "break down", "decompose", or "figure out how to approach" something
- The user describes work-in-progress and is unsure whether to keep going or restart

Do not use it when:
- The user has an existing plan and wants help executing one piece (that's the implementation skill)
- The change is genuinely a one-line fix (typo, config value, single import)
- The user is asking a question, not starting work

## Check the planning bar first

Before cutting, check four triggers:

- over two weeks of work for one person
- over one person, or more than one team touching it
- an outside date: a launch, a contract, a customer promise
- a replacement: anything with an old system to retire

When any one is true, say which, and hand the input to the `plan-project` skill. The work needs a dependency graph, a range estimate, and a resourcing case before it needs a cut, and `plan-project` sends any unit that is still too large back here. When none is true, continue.

## Ask before you plan, but ask minimally

If two reasonable implementers could produce wildly different plans from the input, ask. Otherwise, plan.

Match question depth to input vagueness:
- **Sharp, decomposed input** — implicit planning has already happened. Plan tight, ask minimally.
- **Vague input** ("we need filtering") — ask more readily. The questions are doing decomposition work the input didn't do.

When you ask:
- 1–3 questions, no more
- Each question must point to a decision that changes the cut
- Don't ask about details you can decide yourself and flag as a guess in the Uncertainty section

Worth asking: "Is this filter client-side or does it need a new endpoint?" "Should the empty state link to the existing search, or is that out of scope?" "Are we redesigning the card component or just the page that uses it?"

Not worth asking: "What color should the button be?" "What's the exact copy?" "How should errors be styled?" — none of these change the cut.

Use words that match the tools the work will use: `branch`, `PR`, `merge`, `rebase`, `stack`. `piece` is the unit of decomposition — a piece may be one PR or the base of a small stack.

## Refuse to plan when there's no goal

Some inputs aren't vague — they're empty. "Refactor this repo," "make it better," "modernize the codebase," "improve performance." There's a directional gesture but no specified outcome, no boundary, no definition of done. Clarifying questions don't fix this because the gap is at the goal level, not the scope level.

For these inputs, do not produce a plan. Instead, push back with:

- What outcome do you want? What does "done" look like?
- What's broken or painful right now? What's the trigger for this work?
- What's explicitly out of scope? Without bounds, the work expands forever.

Once the invoker can articulate a goal, decomposition becomes possible. Until then, any cut you produce is arbitrary — you'd be inventing the goal yourself and pretending the invoker chose it.

Distinguishing this from regular vagueness: *"we need filtering on the discovery page"* is vague but has an implicit goal (users can filter discovery results). *"Refactor the discovery page"* is empty — no goal, just a gesture. The first gets clarifying questions; the second gets a goal-definition request.

## Choose a cut strategy with the user

Pieces emerge from a strategy. Naming the strategy out loud lets the user redirect with one sentence ("actually, do this backend-first") instead of re-litigating the cut piece by piece.

Three strategies. Pick by criterion, not by habit:

- **Walking skeleton (vertical slice).** Piece 1 ships an end-to-end thin slice — narrow in features, complete in flow. Subsequent pieces expand it. Use when the architecture is unproven, the user wants something demoable fast, or the rest of the work needs a baseline to stack on. Default for user-facing work.
- **Layered (horizontal slice).** Piece 1 is foundation (data model, API contract, shared component); subsequent pieces consume it. Use when the foundation is unproven *and* a vertical slice would be a stub on quicksand. Common in backend-first work where a frontend skeleton runs in parallel against a stable contract.
- **Hybrid.** A horizontal foundation piece ships first, then 2+ vertical slices stack on it, often parallel-eligible. Use when the data model is genuinely upstream of multiple user-visible flows.

Two factors weigh into the choice beyond demoability:

- **Parallelism.** Cuts that produce more parallel-eligible pieces (disjoint files, no logical dependency) let the office spawn concurrent squads. **Stacked pieces can launch as soon as the base piece's branch exists — no need to wait for it to merge** — so a stack of N pieces can put N branches in flight, not 1. Prefer cuts that exploit this when the work is large enough to benefit.
- **Merge-conflict risk.** Where two pieces would touch the same file in parallel, prefer a cut where one stacks on the other or where they're partitioned to disjoint files. The planner is the cheapest place to avoid a merge conflict; the rebase queue is the most expensive.

Propose one strategy and name the alternative you considered. The user accepts or redirects. Ask the user to pick between two strategies only when they're genuinely tied — same gradient as clarifying questions about the input. Small features (1–2 pieces), bug fixes, and isolated changes don't warrant strategy debate; name the strategy in passing and move on.

## Produce the plan

A markdown document with these sections, in order. Do not skip sections. If a section doesn't apply, say so explicitly.

```
# Decomposition Plan: <short title>

## Goal
One sentence. What changes for whoever uses the system. Not "implement X" — what becomes possible or different.

## Cut rationale
Two to four sentences. Why these N pieces, what the seams are between them, and what alternatives you considered and rejected. The reader should understand why this isn't one big piece and isn't ten tiny ones.

## Out of scope
Things that could plausibly be confused for part of this work but aren't. Be explicit. If there's nothing, say "nothing — this work is self-contained."

## Pieces

### 1. <title>
- **Scope.** What changes. One or two sentences at the behavior level. Drop to file/function level only if a seam is at risk of being misread.
- **Depends on.** Prior piece numbers, or "none."
- **Rough size.** S, M, or L. Not line counts.
- **Reviewability.** Could a reviewer who didn't write this understand the diff without the author explaining it? If "yes with caveats," name the caveat.
- **Intended precedent.** *(optional)* Which existing file, component, or pattern should the implementer model after? Name the specific thing. Omit if the piece introduces a genuinely new pattern. This field exists to prevent the most common agent failure: using the deprecated component, the legacy pattern, or the wrong example — because no one said which one was right.
- **Open questions.** Decisions still owed before this piece can land. "None" is valid.

### 2. <title>
… same structure …

(continue for all pieces)

## Implementation order
- **Cut strategy.** Named (walking skeleton / layered / hybrid). One sentence on why; one sentence on the alternative considered and why it lost. For a single-piece plan, "n/a (single piece)" is valid.
- **Baseline piece.** The piece others stack on, by number. "n/a" when there's no shared baseline.
- **Parallel-eligible pieces.** Which pieces can run as concurrent squads, grouped into batches. Stacked pieces can launch as soon as the base piece's branch exists — no need to wait for the PR to merge. E.g., "Pieces 2 and 3 stack on piece 1's branch and run as concurrent squads as soon as piece 1's branch exists; piece 4 serializes after both."
- **Merge-conflict hotspots.** Files or directories touched by 2+ pieces, with which pieces collide and whether the collision is mechanical (additive, three-way merges fine) or semantic (need sequencing). "None" is valid.
- **Invocation.** Concrete `/team` or `/foreman start` lines reflecting the strategy, parallelism, and stack shape.

## Uncertainty
What you, the planner, are guessing at. Which boundary in the cut would shift if a guess turned out wrong. Distinct from per-piece "open questions" — those are decisions the human owns. This is about places where you assumed something the human should sanity-check.

## Acknowledgment
One block tailored to piece count and shape:

- **One piece** → "Reply with 'go' to proceed. File the ticket, then run `/team <ticket-id>` to start the pipeline."
- **Independent pieces** (each branches from `main`) → "Reply with 'go' to proceed. File the N tickets, then run `/foreman start <repo-path> <ticket-ids>...` to spawn parallel squads from `main`."
- **Stacked pieces** (piece N+1 branches from piece N's branch) → "Reply with 'go' to proceed. File the N tickets. Start the base piece with `/team <ticket-id>`. As soon as its branch exists (open PR is fine — no need to wait for merge), run `/foreman start <repo-path> <stacked-ticket-ids>... --base <base-piece-branch>` to put the rest of the stack in flight on top of it."
- **Mixed** (some stacked, some parallel from `main`) → describe the shape in one or two sentences and use the matching command for each subset.
```

## Constraints on what goes in the plan

**No file paths.** The plan is a contract about what and why; file-level detail belongs to implementation. Exception: when a seam is genuinely a file boundary ("piece 1 is the API contract in `types.ts`, piece 2 consumes it"), say so.

**No code bodies.** Interface signatures and data shapes are fine when they define a seam ("piece 1 exposes `getDiscoveryItems(filter): Item[]`"). Function implementations are not.

**No exact line counts.** S/M/L only. Exact counts incentivize gaming.

**No commit messages, branch names, or PR titles.** Implementation step's job.

## Self-check before delivering

Before producing the plan, run through:

1. **Could this be one piece?** If the rationale for cutting doesn't survive a real read, don't cut. A two-piece plan where piece 2 is "fix the bug from piece 1" is not a cut.
2. **Is each piece reviewable on its own?** If piece 2 only makes sense given piece 1's full context, the cut is wrong.
3. **Does the plan handle the unhappy path?** Empty, error, loading states either belong to a piece or are explicitly out of scope.
4. **Have I named what I'm guessing at?** If Uncertainty is empty for non-trivial work, you're overconfident.
5. **Have I named the cut strategy?** A planner who can't say "this is a walking skeleton" or "this is layered" hasn't really chosen — they've just produced pieces. Name it, briefly justify it, and note what would have made the alternative win.
6. **Did I look at parallelism?** Count the parallel-eligible pieces. If everything serializes, ask whether a different cut could unlock concurrent squads — including stacked squads that branch off a piece-in-review.
7. **Did I look at file overlap?** Two parallel-eligible pieces touching the same file aren't actually parallel-eligible — they're a future merge-conflict scheduled by the planner. Either re-cut to disjoint files, restack one on the other, or flag the overlap explicitly as a hotspot in Implementation order.

## Comprehension check after delivering

After the plan is produced, but before "go," confirm the invoker can narrate it. This is the plan-stage defense against pieces that look reasonable on paper but are too big to hold in one head.

Skip it when every piece is sized S and the original input was sharp enough that you didn't need clarifying questions — the friction isn't worth it. Run it when:

- Any piece is sized M or L, or
- The original input was vague enough that you asked clarifying questions to produce the plan

Ask the invoker, one piece at a time, to summarize what changes and why this piece comes in this order. Frame it as a sanity check on the plan, not a quiz on them. If their narration:

- **Matches the plan**: proceed to acknowledgment.
- **Misses or garbles a piece**: that's evidence the piece is too big or unclear. Propose a finer split, rewrite the piece description, or both. Then re-narrate.
- **Reveals a different mental model than the plan**: stop. Either the plan was wrong, or the input meant something different than you cut for. Revise from the goal down.

The check is on the cut, not on the human. A piece that can't be narrated cleanly probably can't be implemented cleanly either.

## What this skill does NOT do

- Implement any piece. Implementation is a separate skill.
- Open PRs, create branches, make commits, or touch git.
- Estimate calendar time. Sizes are cognitive-load, not days. Calendar ranges come from `plan-project`.
- Decide whether work should happen at all. The planner brings the work; this skill plans it.

If the user asks for any of the above, produce the plan first, then point them at the next step — the Acknowledgment section gives the right invocation for the plan's shape (single piece, parallel pieces, stacked pieces, or mixed).

## Reference examples

When the input shape matches a worked example, consult it for tone and structure. The examples are templates, not rigid forms — adapt to what the input actually contains.

- `references/example-walking-skeleton.md` — User-facing feature where a walking skeleton beats the easy layered default. Piece 1 is a thin end-to-end slice; pieces 2 and 3 stack on its branch and launch as soon as that branch exists.
- `references/example-frontend-feature.md` — Small visual feature with a data dependency. Layered cut with two parallel-eligible pieces (data hook and presentational component) that branch from `main`, plus a serialized integration piece. Distinct directories, zero merge-conflict risk.
- `references/example-cross-cutting-refactor.md` — Cross-cutting consolidation across multiple surfaces with feature-flag scaffolding. Layered foundation; multiple parallel migration squads stack on it; final cleanup serializes last to avoid the only merge-conflict hotspot.
