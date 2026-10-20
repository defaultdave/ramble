// Dave's minutes for the plan scripts (P4 artifacts 5 and 7): gates on fan-out units, people checks, recurring weekly
// work, and his own tasks. Every figure is an assumption until P5's dave_minutes calibrate it.

import type { Unit } from "./units";

export type Three = { o: number; m: number; p: number };

// ---------- Dave's minutes, three points (o: clean pass; m: typical, small fixes included; p: a second review round) ----------
/** Approval mode only: approve the push, the PR, and the review start. */
export const APPROVALS: Three = { o: 3, m: 5, p: 10 };
/** Read the review verdict and the PM's manifest check, then merge to main. */
export const VERDICT_AND_MERGE: Record<1 | 2 | 3, Three> = { 1: { o: 5, m: 8, p: 15 }, 2: { o: 8, m: 15, p: 25 }, 3: { o: 15, m: 25, p: 45 } };
/** Critical tier: Dave reads the diff and the race or access tests himself. */
export const CRITICAL_READ: Record<1 | 2 | 3, Three> = { 1: { o: 10, m: 15, p: 25 }, 2: { o: 15, m: 30, p: 50 }, 3: { o: 30, m: 45, p: 90 } };
/** Read the rebase-auditor output; restart the review when the rebase touched files in the diff. */
export const REBASE: Three = { o: 0, m: 5, p: 20 };
/** Units that add a migration or edit `confirmOrder` or `reserveSpaces`, which every open branch near them rebases over. */
export const REBASE_SHARED: Three = { o: 5, m: 10, p: 30 };
export const SHARED_FILE_UNITS = new Set(
  "U-004a U-006 U-008b U-010 U-012 U-014b U-015 U-017 U-018 U-019 U-020 U-038 U-041 U-060 U-062a U-064a U-065a U-081 U-084 U-086 U-088 U-109 U-114".split(
    " ",
  ),
);
/** A required check the senior agent cannot clear in three attempts, or a manifest check that needs Dave's call. */
export const ESCALATION: Three = { o: 0, m: 5, p: 25 };
/** Host and ops screens have no drawn design, so Dave looks at the preview before merging. */
export const PREVIEW: Three = { o: 5, m: 10, p: 20 };
export const PREVIEW_UNITS = new Set(
  "U-067 U-068 U-069 U-070 U-071 U-072 U-073 U-112 U-074a U-074b U-074c U-075 U-076a U-076b U-076c U-077 U-113 U-108 U-078 U-080 U-081 U-082 U-083a U-083b U-084 U-085 U-110".split(
    " ",
  ),
);
/** Every unit: log dave_minutes, delete the worktree branch. */
export const CLOSE: Three = { o: 1, m: 2, p: 4 };
export const APPROVAL_MODE_UNITS = 3; // ADR 0010: the first couple of fan-out units run in approval mode

// ---------- recurring per P5 week ----------
/** Merge the PM's bookkeeping PR (units.yaml actuals, STATUS, delta-log): actuals are known only after a unit's merge. */
export const BOOKKEEPING: Three = { o: 5, m: 10, p: 20 };
/** Triage red nightly or main runs and merge the fix-forward PRs, from U-105's merge. */
export const CI_TRIAGE: Three = { o: 15, m: 45, p: 120 };
/** One production promotion: staging migration and smoke, production migration, the printed promote command, warm pages. */
export const RELEASE: Three = { o: 10, m: 20, p: 45 };
/** U-094a runs as weekly fix PRs over its 60 days, each a merge and a promotion. */
export const TAIL_FIX_PRS = 8;

export const DAVE_TASKS: { task: string; when: string; scope: "demo" | "real-job"; phase: "P4" | "P5"; minutes: Three }[] = [
  {
    task: "Create the Neon project for the concurrency spike",
    when: "P4, before U-013",
    scope: "demo",
    phase: "P4",
    minutes: { o: 10, m: 15, p: 30 },
  },
  { task: "Publish the Figma library", when: "P4, before U-028", scope: "demo", phase: "P4", minutes: { o: 5, m: 10, p: 20 } },
  {
    task: "Create the Project board and its fields; run the printed issue commands",
    when: "plan freeze",
    scope: "demo",
    phase: "P5",
    minutes: { o: 20, m: 40, p: 75 },
  },
  { task: "Tag the plan freeze and approve the P5 start", when: "end of P4", scope: "demo", phase: "P5", minutes: { o: 10, m: 20, p: 30 } },
  {
    task: "Neon project for the build, the Vercel integration for preview branches, the staging branch",
    when: "U-003",
    scope: "demo",
    phase: "P5",
    minutes: { o: 10, m: 20, p: 45 },
  },
  {
    task: "Neon API key as a GitHub secret for the branch-cleanup step",
    when: "U-003",
    scope: "demo",
    phase: "P5",
    minutes: { o: 5, m: 10, p: 20 },
  },
  {
    task: "Vercel project, environment variables, first preview deploy",
    when: "U-002",
    scope: "demo",
    phase: "P5",
    minutes: { o: 15, m: 30, p: 60 },
  },
  {
    task: "Blob store (or an S3-compatible bucket) and its token for the storage port",
    when: "U-010",
    scope: "demo",
    phase: "P5",
    minutes: { o: 5, m: 10, p: 20 },
  },
  {
    task: "Cloudflare R2 buckets and keys (locked audit export, hourly dump); Neon API key for the restore test",
    when: "before U-020 and U-098",
    scope: "demo",
    phase: "P5",
    minutes: { o: 15, m: 25, p: 45 },
  },
  {
    task: "Sentry, Better Stack, and Axiom accounts and keys",
    when: "U-007, U-097",
    scope: "demo",
    phase: "P5",
    minutes: { o: 20, m: 35, p: 60 },
  },
  {
    task: "MFA on every vendor account (GitHub, Vercel, Neon, Sentry, Better Stack, Axiom, Figma, Cloudflare)",
    when: "U-102",
    scope: "demo",
    phase: "P5",
    minutes: { o: 15, m: 30, p: 60 },
  },
  {
    task: "Make the repo public (DECISIONS, 2026-10-18); turn on CodeQL default setup and secret push protection",
    when: "plan freeze",
    scope: "demo",
    phase: "P5",
    minutes: { o: 10, m: 15, p: 25 },
  },
  { task: "Main ruleset requiring the U-001 CI checks", when: "U-001", scope: "demo", phase: "P5", minutes: { o: 5, m: 10, p: 20 } },
  {
    task: "Add the U-105 smoke to the ruleset's required checks",
    when: "U-105",
    scope: "demo",
    phase: "P5",
    minutes: { o: 2, m: 5, p: 10 },
  },
  {
    task: "Vercel firewall rate-limit rule on the shared beacon path prefix (Hobby allows one)",
    when: "U-008b",
    scope: "demo",
    phase: "P5",
    minutes: { o: 5, m: 10, p: 20 },
  },
  {
    task: "GitHub Actions secrets for the pulse workflow (it runs from Actions once the repo is public)",
    when: "U-005",
    scope: "demo",
    phase: "P5",
    minutes: { o: 5, m: 10, p: 20 },
  },
  { task: "Figma access token for publishing Code Connect", when: "U-029", scope: "demo", phase: "P5", minutes: { o: 5, m: 10, p: 20 } },
  {
    task: "Email provider account and sending-domain records",
    when: "real job (the demo uses the dev mailbox)",
    scope: "real-job",
    phase: "P5",
    minutes: { o: 20, m: 40, p: 90 },
  },
  {
    task: "Cancel the site builder and its plugin; keep the domain",
    when: "U-094b, real job",
    scope: "real-job",
    phase: "P5",
    minutes: { o: 5, m: 10, p: 20 },
  },
  {
    task: "Domain cutover: DNS records and TLS for the live address; Search Console verification and access for the U-093 page export and the U-094a crawl-error reviews",
    when: "U-093, U-115, and launch, real job",
    scope: "real-job",
    phase: "P5",
    minutes: { o: 30, m: 60, p: 120 },
  },
];

export const add = (a: Three, b: Three): Three => ({ o: a.o + b.o, m: a.m + b.m, p: a.p + b.p });
export const times = (a: Three, k: number): Three => ({ o: a.o * k, m: a.m * k, p: a.p * k });
export const zero: Three = { o: 0, m: 0, p: 0 };
export const sum = (xs: Three[]) => xs.reduce(add, zero);
export const hours = (t: Three) => `${(t.m / 60).toFixed(1)} h (${(t.o / 60).toFixed(1)} to ${(t.p / 60).toFixed(1)})`;

/** The terms of Dave's gate minutes on one fan-out unit; approval mode adds the three approvals. */
export function gateTerms(u: Unit, approval: boolean): Record<string, Three> {
  if (u.id === "U-094a")
    return {
      "post-launch fix PRs": times(add(add(VERDICT_AND_MERGE[1], RELEASE), approval ? APPROVALS : zero), TAIL_FIX_PRS),
      close: CLOSE,
    };
  return {
    "verdict and merge": VERDICT_AND_MERGE[u.complexity],
    "critical-tier read": u.review === "critical" ? CRITICAL_READ[u.complexity] : zero,
    rebase: SHARED_FILE_UNITS.has(u.id) ? REBASE_SHARED : REBASE,
    escalation: ESCALATION,
    preview: PREVIEW_UNITS.has(u.id) ? PREVIEW : zero,
    approvals: approval ? APPROVALS : zero,
    close: CLOSE,
  };
}

/** Dave's gate minutes on one fan-out unit. */
export function gateMinutes(u: Unit, approval: boolean): Three {
  return sum(Object.values(gateTerms(u, approval)));
}

// ---------- tiered auto-merge (ADR 0010, amended 2026-10-20) ----------
/** Dave's weekly promotion of `integration` to `main`: read the nightly smoke and the overnight race and access runs, promote. */
export const PROMOTION: Three = { o: 15, m: 30, p: 60 };

/**
 * Dave's per-unit gate minutes under tiered auto-merge: agents merge on their own verdicts, so only escalations reach him.
 * The post-launch tail keeps its weekly fix PRs, each a production promotion, which stay his.
 */
export function tieredGateTerms(u: Unit): Record<string, Three> {
  if (u.id === "U-094a") return { "post-launch promotions": times(RELEASE, TAIL_FIX_PRS) };
  return { escalation: ESCALATION };
}

/** A critical-tier unit's diff read inside the weekly promotion batch; standard-tier units go straight to `main`. */
export const batchReadMinutes = (u: Unit): Three => (u.review === "critical" ? CRITICAL_READ[u.complexity] : zero);

/** Dave's minutes on a unit's people check, if it has one. */
export const peopleMinutes = (u: Unit): Three => (u.acceptance_by_people ? u.acceptance_by_people.minutes : zero);
