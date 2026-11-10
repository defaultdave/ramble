# <unit title>

Plan unit `<id>` · Route: <human only | human-led | agent fan-out> · Depends on: <ids, or none> · Expected <n> days (<o> / <m> / <p>)

## Outcome

<What a user or the system can do when this is done. One or two sentences.>

## Acceptance criteria

- [ ] <observable behaviour>
- [ ] <the unhappy path: empty, error, and loading states, or a line saying which unit owns them>
- [ ] Quality gates pass: build, lint, typecheck, test

## Scope

```
SCOPE MANIFEST:
  IN SCOPE:
    - <one line per acceptance criterion>
  OUT OF SCOPE:
    - <adjacent units, by id>
    - <anything in the brief's non-goals this could be mistaken for>
  in_scope_globs:
    - <narrowest set of paths>
```

## Intended precedent

<The existing file, component, or pattern to model after. Omit when the unit introduces a new pattern.>

## Open questions

<None, for an agent fan-out unit. Otherwise each question with who answers it.>
