# Scope Discipline

**Every agent operates within an explicit scope boundary. Going beyond it is a failure, not initiative.**

## The Scope Manifest

Every implementation task includes a scope manifest:

```
SCOPE MANIFEST:
IN SCOPE: [specific tasks to implement]
OUT OF SCOPE: [tasks, phases, features that must NOT be touched]
REFERENCE CODE: [use for patterns only, not copying]
```

## Rules

1. **Do exactly what is asked.** Not more. Not less. Not "while I'm at it."

2. **Phases are hard boundaries.** Phase 1 does not authorize Phase 2-5 work. A plan for future phases is context, not permission.

3. **Reference code is a style guide.** Read it for patterns and conventions. Do NOT copy files, rebuild components, or implement features from it that are outside your scope.

4. **Echo before coding.** Senior must acknowledge the scope manifest before writing any code. This forces the agent to internalize the boundary.

5. **Review catches violations.** The review agent audits every diff against the scope manifest. Out-of-scope changes = REQUEST_CHANGES, no exceptions.

6. **The caller verifies.** After implementation, whoever spawned the implementer checks what files were created/modified against the scope manifest. Violations are caught before review even starts.

7. **Scope creep is logged, not built.** If you notice adjacent work, put it in a "Suggestions" section of your output. Do not build it.

> See [docs/rules/scope-discipline.md](../../docs/rules/scope-discipline.md) for rationale and history.
