---
name: design
description: Use this skill when the user asks to create, review, or list a design document, RFC, or feature spec. Triggers on phrases like "create a design doc", "/design", "write an RFC for X", "review the design doc for Y", "list design docs", or when a feature requires architectural alignment before implementation. Produces design docs (problem statement, goals/non-goals, proposed solution, alternatives, testing strategy) following the quality bar defined in the skill.
---

# Design Doc Skill

Create and manage design documents (RFCs) for complex features or new projects. Design docs are created before implementation to align on approach, identify risks, and serve as handoff artifacts.

## Usage

Invoke the skill with a natural-language request. Common variants:

- "Create a new design doc" — interactive flow
- "Create a design doc from issue #N" — pull requirements from a GitHub issue
- "List design docs for this project"
- "Review the design doc at `<path>`"

## Process

### Creating a new design doc

1. **Determine project context:**
   - Detect project from current working directory or git remote
   - Look for existing design docs under `docs/designs/` in the target repo (create the directory on first save)

2. **Gather design inputs:**
   - If an issue number is provided: fetch issue from GitHub, extract requirements
   - If no issue: ask user for feature name, problem statement, and scope

3. **Create the design doc:**
   - Use the section list under **Template** below
   - Fill in project context, component architecture, data model
   - Include alternatives considered
   - Define implementation phases
   - Write testing strategy and security considerations

4. **Store the doc:**
   - Save to `docs/designs/{issue}-{slug}.md` in the target repo
   - If no issue number, use date-based prefix: `{YYYY-MM-DD}-{slug}.md`

5. **Present for review:**
   - Show summary to user
   - Highlight open questions
   - Ask for approval or revision

### Listing design docs

1. Detect current project
2. List all files in `docs/designs/`
3. Show each doc's title, status, date, and related issue

### Reviewing an existing design doc

1. Read the specified design doc
2. Evaluate against the quality bar:
   - Problem clearly stated?
   - Non-goals defined?
   - Alternatives considered?
   - TypeScript interfaces for key types?
   - Testing strategy concrete?
   - Accessibility section complete? (for UI features)
   - UX friction points addressed? (forms, navigation, keyboard)
   - Open questions identified?
3. Provide feedback and suggestions

## Template

A design doc has these sections:

- **Problem Statement** — What problem, who has it, why it matters
- **Goals / Non-Goals** — Explicit boundaries
- **Proposed Solution** — Architecture, data model, API changes, UI design
- **Alternatives Considered** — At least one rejected approach with rationale
- **Implementation Phases** — Ordered tasks
- **Testing Strategy** — Unit, integration, e2e, accessibility
- **Security Considerations** — Auth, validation, data sensitivity
- **Open Questions** — Honest unknowns
- **Handoff Checklist** — Readiness criteria for implementation

## Reference

Completed design docs live under `docs/designs/` in each repo and serve as the quality-bar reference.

## Integration with Workflow

- `design` runs before `decompose-ticket` or `/senior` on any change large enough to need alignment
- `plan-project` runs `design` as the first of its seven artifacts when work starts from a concept or a client brief
- Design docs become **handoff artifacts** to the senior agent
- Senior reads the design doc before starting implementation
- Doc status updated to "Implemented" when work is complete
- `/team {issue}` can trigger design doc creation when architect is in the composition

## Quality Bar

A good design doc:
- States the problem in 2-3 sentences
- Lists explicit non-goals
- Describes at least one rejected alternative
- Includes key type/interface signatures (NOT implementation code)
- Has concrete testing strategy (not "we'll add tests")
- Identifies open questions honestly
- Can be understood by someone unfamiliar with the codebase
- **For UI features:** includes a complete Accessibility section covering:
  - Keyboard navigation plan
  - Screen reader considerations (ARIA labels, live regions)
  - Color contrast requirements
  - Focus management (after modals, form submits, navigation)
  - Required field indication strategy
  - Error announcement to assistive technology
- **For UI features:** addresses UX friction:
  - Form field count and auto-fill opportunities
  - Smart defaults (dates, selectors, pre-populated fields)
  - Navigation hierarchy (breadcrumbs, back links, sidebar state)

## Code in Design Docs — The Rule

**Design docs should NOT contain implementation code.**

Reference: [Stan Design Docs](https://github.com/stan-dev/design-docs) — "The technical specification needs to be specific enough that it can be approved as a plan for implementation. These documents should not include every last detail of an implementation — for example, rarely will code other than function or class signatures be appropriate in either a functional or technical specification."

**What belongs in a design doc:**
- Function/class/interface **signatures** (inputs, outputs, types)
- File structure diagrams
- Component interaction diagrams (UML, ASCII, or Mermaid)
- Data flow descriptions (text + diagrams)
- Decision tables and trade-off matrices
- Pseudocode ONLY when the algorithm itself is the design decision

**What does NOT belong:**
- Full function bodies or component implementations
- Configuration objects or config file contents
- Import statements
- Hook usage patterns or state management wiring
- CSS/Tailwind class strings
- API client implementations
- Complete middleware or route handler code

The implementer should be able to read the design doc and know WHAT to build and WHY, then make their own implementation decisions for HOW. If the design doc contains copy-pasteable code, it's doing the implementer's job and will become stale immediately.
