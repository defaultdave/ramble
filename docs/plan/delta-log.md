# Delta log

Where reality departs from the frozen plan (`plan-frozen-2026-10-20`). One line per departure: the date, what changed, by how much, and why. A unit more than 25% off its estimate gets a line when it closes (BUILD-PLAN, P5).

| Date | Unit or file | What changed | Why |
|---|---|---|---|
| 2026-10-20 | BUILD-PLAN.md, 06-estimate.md, PM memory | Before the repo went public, history was rewritten to replace three personal notes with neutral wording (open decision 2's scheduling note, a calendar caveat in the estimate, a memory line). No plan content, number, or date changed; the freeze tag was re-created on the rewritten freeze commit. | Dave: personal notes stay out of a public repo |
| 2026-10-20 | merge-desk-runbook.md (A4, B1) | A4 records the App's Client ID as well as the App ID and installation ID; the token script signs with the Client ID, or the App ID when none is recorded. No step, owner, or estimate changed. | GitHub now recommends the Client ID as the token issuer (shown on the App page) |
| 2026-10-20 | merge-desk-runbook.md (B2); phase order | Phase C (merge settings, `integration`, rulesets) ran at the freeze, before U-118, so U-118's own PR merges with Dave's bypass (`--admin`) instead of as an ordinary merge. The App (phase A) was created the same day, also before U-118. | Dave handed the freeze steps to the PM and set up the App the same evening |
| 2026-10-20 | U-118 Merge desk and agent identity | Started 2026-10-20, four working days before the planned P5 start (Oct 26); at the start Dave finished runbook phases A and C, about half the unit. Phase B and D remain. The frozen estimate (1.5 / 3 / 7 days) stands; actual days are counted from 2026-10-20 when it closes | Dave set up the App and the PM ran phase C at the freeze, so the rest of the merge desk could start at once |
