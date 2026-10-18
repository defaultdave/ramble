# Discovery

> **Skipped 2026-10-18 (Dave).** The PRD is drafted straight from `sealed/client-brief.md`, so there is no reveal or discovery delta. Session 1 (`transcripts/2026-10-18-session-1.md`) closed after the opening greeting. The kit below stays for reference and for follow-up questions to the client. See `docs/plan/DECISIONS.md`.

Ramble is run as a client engagement. The client is played by the `ramble-client` agent, which answers from a sealed company brief that Dave does not read.

## Running a session

Terminal:

```
cd ~/Workspace/ramble && claude --agent ramble-client
```

Desktop app (Code tab), which has no agent picker:

1. Ask `ramble-pm` to add `"agent": "ramble-client"` to `.claude/settings.local.json` (gitignored). While it is set, every new session in this folder starts as the client.
2. Start a new Code session in the `ramble` folder, model Sonnet.
3. Send `PAUSE CLIENT` first. A paused-client reply confirms the agent loaded (tested 2026-10-18). Then `RESUME CLIENT`.
4. After `END SESSION`, ask `ramble-pm` to remove the key.

- Open like a real call. The founder is on by default; ask for other people by role if you want them.
- `PAUSE CLIENT` / `RESUME CLIENT` to step out of character (mechanics only, no hints).
- `END SESSION` to close. The transcript lands in `transcripts/`.
- Several short sessions are fine and realistic (a founder call, then ops, then finance).

## Coverage checklist

Topics a discovery should reach. This lists areas, not questions. Asking the right questions inside each area is the skill being rehearsed. After each session, `ramble-pm` marks what the transcript covered.

| Area | Covered |
|---|---|
| The business today: what they do, revenue, audience, why a new site now | |
| Stakeholders: who decides, who is affected, where they disagree | |
| Customers: who books, on what device, what they're buying for | |
| Supply: who the hosts are, how inventory and availability work today | |
| Business model: fees, merchant of record, payouts, refunds | |
| Goals: what success means, in numbers | |
| Launch scope: must-have, nice-to-have, later | |
| Constraints: budget, timeline and what really drives it, team | |
| Legal and compliance: payments, accessibility, privacy, tax | |
| Operations: support, cancellations, edge cases | |
| Marketing and growth: SEO, email, partnerships | |
| Risks and unknowns: what they don't know yet | |

## After discovery

1. `ramble-pm` drafts `docs/product/PRD.md` **from the transcripts only.**
2. Dave signs off the PRD as the client.
3. **Reveal.** Only after sign-off, `ramble-pm` compares the PRD against the sealed brief and writes `discovery-delta.md`: what discovery found, what it missed, and which missed facts would have changed the build. That delta is part of the portfolio package.

## Sealed

`sealed/` holds the client brief and an addendum of facts the client improvised during sessions. Since 2026-10-18 it is the PRD's source and `ramble-pm` reads it.
