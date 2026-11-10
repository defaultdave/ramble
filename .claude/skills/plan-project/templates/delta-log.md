# Delta Log: <project>

## Estimate of record

Recorded <YYYY-MM-DD>, before the first commit. These rows stay as written; a revision is a new dated row under Re-estimates.

| Unit | Route | o | m | p | In | Owner min | Expected (days) |
|---|---|---|---|---|---|---|---|
| | | | | | days or rounds | agent-built only | |

- Critical path: `<a -> b -> c>`
- Range on the path: <low> to <high> weeks
- Staffing chosen: <row from the Staffing table>
- Owner time: <N> hours at <N> hours a week, <N> weeks, against a floor of <N> weeks
- Assumed: <N> days a round; <N> owner hours a week; review fraction <N>% (days-estimated agent units only)

## Actuals

One row as each unit closes. Rounds come from the unit's check runs or verdict files, fails included; owner minutes from the owner's message timestamps. Leave a cell blank only when its source is missing, and say which.

| Unit | Started | Finished | Actual (days) | Expected (days) | Rounds | Owner min | Delta | Why |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

## Calibration

Once, after the third agent-built unit merges. Set the medians below into `plan.json`, set `assumptions.calibrated`, run the script, and add the result as a Re-estimate row.

| Date | Units measured | Median rounds | Median days a round | Median owner min | Owner hours a week (so far) | New path range | New owner-time weeks |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## Measures

One row a week. Targets are starting points for an agent-built project; set the project's own at the launch check.

| Week of | Owner hours | Orchestrator share of cost (Opus share) | Rounds per unit, median / p90 | Defects after merge per merged PR (found by eye) | Owner queue: open / oldest (days) | Starting context / status file size | Repeated corrections |
|---|---|---|---|---|---|---|---|
| Target | at or under the plan's hours | under 30% (Opus only in design chats) | 1 / 2 | under 1 (0) | 5 / 3 | under 50K / under 25 KB | 0 |
| | | | | | | | |

How each is collected:
- **Owner hours:** the owner's message timestamps across the project's transcripts, summed by gap or counted by distinct hour.
- **Rounds:** check runs or verdict files per unit, fails included.
- **Defects after merge:** audit items filed against merged code, divided by PRs merged that week; separately, defects the owner found by looking.
- **Owner queue:** the board's owner items with an `Owner since` date.
- **Starting context / status file:** the first-call context line from the profiler; `wc -c` on the status file in its publish step.
- **Repeated corrections:** owner messages that repeat a correction already given; any count above 0 becomes a check, not more prose.

## Re-estimates

One row per milestone, after updating `plan.json` and running the script again.

| Date | Milestone | Remaining range (weeks) | Owner-time weeks | What changed |
|---|---|---|---|---|
| | | | | |

## Read-back

Written when the tail unit closes.

- Furthest off, by how much, and why:
- Work that was never on the plan:
- Measured: days a round, owner minutes per agent-built unit, owner hours a week, review fraction for any days-estimated agent units:
- Measures that missed their target, and what changed because of it:
- Change to make to the next plan:
- Reference-class entry for the next plan: `{ "name": "<project>", "units": <count>, "days": <actual serial days> }`
