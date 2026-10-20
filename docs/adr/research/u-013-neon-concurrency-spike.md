---
title: U-013, Neon concurrency spike
date: 2026-10-19
status: done 2026-10-19 (local Postgres and a real Neon project, AWS us-east-1, free tier, run from a laptop)
units: U-013, then U-014a, U-014b and every money path
code: docs/adr/research/spikes/u-013-neon/
---

# Neon concurrency spike (U-013)

## Question

Under more parallel reserves than spaces, which connection style keeps the hold count at or under capacity: a pooled interactive transaction with `FOR UPDATE` on the session row, or Neon's HTTP driver? What does each cost in latency?

## Done: the lock logic, on real Postgres (embedded, local)

Three sessions of capacity 10, 60 parallel reserves of 1 to 3 spaces each (demand about 120), 5 rounds per variant. Same SQL the Neon run will use.

| Variant | Rounds oversold | Total spaces over | Accepted per round |
|---|---|---|---|
| Interactive transaction: `SELECT … FOR UPDATE` on the session row, read the sum, insert if it fits | 0 of 5 | 0 | 18, 18, 18, 18, 18 |
| One statement: `WITH s AS (… FOR UPDATE) INSERT … WHERE (SELECT sum(party) …) + n <= capacity` | **4 of 5** | **103** | 18 to 32 |
| One statement: conditional counter update on the session row (`UPDATE … SET taken = taken + n WHERE taken + n <= capacity`) feeding the insert | 0 of 5 | 0 | 18, 18, 18, 18, 18 |
| Transaction with no lock (control) | 5 of 5 | 65 | 19 to 27 |

What this says:

- **The design's lock is right.** The interactive transaction under the session-row lock never oversold.
- **A single SQL statement is not a substitute for the lock when the check reads other rows.** Under `READ COMMITTED`, a statement that waits on the row lock re-reads the locked row but not the other tables its subquery read, so the sum is stale and the session oversells. This matters because Neon's HTTP driver can only send one statement or a fixed batch per call; it cannot hold a transaction open while code decides.
- **The only HTTP-compatible safe form is the counter column**, which makes the capacity check part of the locked row's update. The design's `hold` model reads held spaces from rows, so adopting it means adding and maintaining a counter. That is a design change, not a driver swap.

## Done: the same variants on Neon

Same harness, 8 rounds per variant, 60 parallel reserves on 3 sessions of capacity 10, 20-connection pools filled before timing. Latency is laptop to Neon us-east-1, so compare variants, not absolute numbers.

| Variant | Rounds oversold | Spaces over | Accepted per round | Whole round (60 reserves), median | Per reserve p50 / p95 |
|---|---|---|---|---|---|
| `pg` on the **pooler** host, interactive transaction with `FOR UPDATE` | 0 of 8 | 0 | 18 | 987 ms | 543 / 910 ms |
| `pg` on the direct host, same transaction | 0 of 8 | 0 | 18 | 953 ms | 536 / 820 ms |
| Neon **WebSocket Pool** on the pooler, same transaction | 0 of 8 | 0 | 18 | 1025 ms | 571 / 958 ms |
| Neon **HTTP driver**, one statement, lock plus sum subquery | **8 of 8** | **615** | 30 to 60 | 65 ms | 52 / 64 ms |
| Neon **HTTP driver**, one statement, counter column | 0 of 8 | 0 | 18 | 70 ms | 52 / 66 ms |
| Transaction with no lock (control) | 8 of 8 | 128 | 27 | 307 ms | 169 / 305 ms |

Zero errors in any variant. 18 accepted per round is the correct answer here (3 sessions at 10 spaces, party sizes of 1 to 3).

What this says:

1. **ADR 0002's choice holds.** The pooled interactive transaction (pgbouncer transaction mode) is correct under contention, as are the direct host and the WebSocket pool. The pooler does not break `FOR UPDATE`.
2. **The HTTP driver with a row-reading check oversells badly** (615 spaces over in 8 rounds). Never use it for capacity checks.
3. **The counter column is correct over HTTP and about 10 times faster** per round than the transactions here, because each reserve is one round trip instead of four to five. Pooled-transaction cost is mostly network round trips from a laptop; from Vercel in us-east-1 to Neon in us-east-1 each trip is far shorter, so expect the gap to narrow. Not measured on Vercel.
4. The pooled interactive path is the safe one that matches the current design's data model. The counter column is a design change: a `taken` column on the session row and every path that moves spaces (reserve, release, expiry, confirm) must keep it in step. That is more places to get wrong; it is not recommended for the demo.

## Recommendation

Keep ADR 0002 as written: pooled interactive transaction on the reserve path (and every money path that takes locks). HTTP driver for single reads only, with a lint or code-review rule that it never runs a capacity check. The ADR's "what would change the call" trigger (HTTP batch misbehaves under the lock) is confirmed in spirit, and the fallback it names (WebSocket pool) also works, so no ADR change is needed. Revisit the counter column only if the load test (U-096) shows reserve latency matters at launch scale.

## Re-score

U-013 is done. Its answer removes the driver question from U-012 (applies the U-013 decision) and U-014a. Scores of those units are unchanged: they were already uncertainty 2 and 3 for the lock-order and locking work, which this spike does not touch.
