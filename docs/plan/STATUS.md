# Status

**Updated:** 2026-10-18
**Phase:** P1 PRD (exit: Dave signs off the PRD as the client). Discovery was skipped on 2026-10-18; the PRD is drafted from the client brief.

## Done
- P0: desktop wireframes v0 in Figma (6 screens, notes, click-through); repo, PM agent, project memory, build plan spec; discovery kit.
- 2026-10-08: Ramble also carries the performance examples (see `DECISIONS.md`). Brief lives in the vault at `Projects/Personal/Ramble Perf Lab - Kickoff.md`.
- 2026-10-16: **Market scan** at the smaller scope Dave set. `docs/product/market/market-scan.md` plus 6 teardowns. Fee and cancellation claims fact-checked (85 checked, 38 corrected). Weakest reads: Viator and anything past the detail page.
- 2026-10-18: **Discovery skipped** (Dave). Sealed-brief rule lifted in `CLAUDE.md`, both agent files, the discovery README, `BUILD-PLAN.md` P1, and PM memory. Session 1 closed after the greeting; temporary client agent key removed from `.claude/settings.local.json`.
- 2026-10-18: **PRD v0.1** reviewed by three independent reviewers (fidelity, coverage, quality): 67 findings, 3 high. The PM checked them against the brief and rewrote the PRD as **v0.2** (`docs/product/PRD.md`): 77 requirements (`PRD-01` to `PRD-77`), 7 goals, 9 constraints, 5 assumptions, 12 risks, 22 open client decisions (`Q-01` to `Q-22`) with owners and needed-by phases, and a cut order covering every Should. Blocks and Depends-on notes checked by script.

- 2026-10-18: **PRD v0.2 rechecked** by three fresh reviewers: 61 of 67 v0.1 findings resolved, plus 37 smaller new issues (unsupported labels, untagged proposals, the uptime and restore-time conflict, GMV on a different base from commission, no tax-treatment requirement). All applied as **v0.3**: 78 requirements (`PRD-78` is the tax treatment), 22 open questions. Script-checked; the v0.3 edits were not re-reviewed by agents.

## In flight
- Nothing. PRD v0.3 is with Dave for sign-off.

## P1 progress
| Step | State |
|---|---|
| 1. Discovery sessions | skipped 2026-10-18 |
| 2. Market scan | done 2026-10-16 |
| 3. PRD | v0.3 ready for sign-off |
| 4. Reveal + discovery delta | dropped 2026-10-18 |

## Blocked on Dave
1. **PRD sign-off**, including the client decisions in its section 10 (Q-01 to Q-13). Some can stay open past sign-off if the PRD says what they block.
2. **Spec conflict.** The Perf Lab brief makes each detail-page fix a build requirement, and its router-boundary section assumes App Router plus Pages Router. `BUILD-PLAN.md` says nothing technical is decided without a PRD requirement. The PRD now has a mobile performance requirement (`PRD-68`, Core Web Vitals "good" at p75), which the detail-page fixes can trace to. The router question still has no PRD driver and goes to ADR R1.
3. **Workbook order** (open decision 1 in `BUILD-PLAN.md`). Needed before P4.
4. **First commit.** The repo has no commits. The earlier advice to gitignore `sealed/` no longer applies now that the brief is open.
5. **Method Layer 0** (open decision 3). Not needed until P6.

## Next
Dave reads `docs/product/PRD.md` as the client: section 1 (summary), section 10 (the 22 open decisions and the cut order), and anything else he wants. He answers the Q-## decisions he can and signs off; open ones can stay open if the PRD says what they block. After sign-off, P2 (ADRs, researched in one parallel pass) and P3 (mobile design in Figma; the Figma connector still needs authorizing) start together.
