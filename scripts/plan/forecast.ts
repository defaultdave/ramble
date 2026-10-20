#!/usr/bin/env bun
// P4 artifacts 6 and 7: Monte Carlo forecast over docs/plan/units.yaml.
//
// Each run samples every unit's days from its three-point estimate (beta-PERT, the distribution behind (o + 4m + p) / 6),
// then schedules the graph. One estimate-day is 6 focused hours of the owner's time; see docs/plan/06-estimate.md.
//
// Run: bun scripts/plan/forecast.ts --report estimate|resourcing [options]
//   --report estimate    the graph with every owner full time and no limit on people: the floor no staffing beats,
//                        against the single PERT path from critical-path.ts, plus how often each unit is critical
//   --report resourcing  the SCENARIOS below: who carries the human-led units and the gates, at how many hours a week
//   --report schedule    JSON for the roadmap page: each unit's P50 start and finish, the milestones, and the people's
//                        hours a week, for the scenarios named in --scenarios (names separated by "|"); written to --out
//   --scope demo|real-job, --should   as in critical-path.ts
//   --runs N             runs per scenario (default 2000)
//   --seed N             random seed (default 6), so the generated blocks are reproducible
//   --start YYYY-MM-DD   first P5 working day (default 2026-10-26)
//   --deadline YYYY-MM-DD  the client's date, for the chance of making it (default 2026-12-01, PRD Q-07)
//   --systemic O,M,P     one factor per run on every unit's days and Dave's gate minutes (default SYSTEMIC); 1,1,1 turns it off
//   --write FILE         replace the generated block in FILE: <!-- forecast:BLOCK:start --> ... <!-- forecast:BLOCK:end -->,
//                        where BLOCK is the report name, plus "-real-job" with --scope real-job and "+should" with --should
//
// Solo days (one engineer, no coding agents) come from docs/plan/estimate-panel.json, not the record: no unit is built that way.

import {
  add,
  batchReadMinutes,
  BOOKKEEPING,
  CI_TRIAGE,
  CLOSE,
  DAVE_TASKS,
  gateTerms,
  peopleMinutes,
  PROMOTION,
  RELEASE,
  sum,
  type Three,
  tieredGateTerms,
} from "./dave-time";
import { DAVE_SHARE, LAUNCH_REVIEW, points3, schedule, selectScope, type ScopeName } from "./graph";
import { flag, loadUnits, lookup, option, writeBlock, type Unit } from "./units";

/** Focused hours in one estimate-day. */
const DAY_HOURS = 6;
/** A full-time engineer's focused hours a week. */
const FULL_TIME = DAY_HOURS * 5;
/** A sprint on the roadmap: two working weeks. */
const SPRINT_DAYS = 10;
/** Simulation step, in working days. */
const DT = 0.1;
/** Days off besides weekends, inside any plausible P5 window. */
const HOLIDAYS = new Set(["2026-11-26", "2026-11-27", "2026-12-24", "2026-12-25", "2026-12-31", "2027-01-01"]);
/** A run is bound by people when their finish is this much later than the same run with every owner full time and free. */
const BOUND_RATIO = 1.15;
/** Merging a standard-tier unit on a green verdict, without reading it (lever). */
const MERGE_ON_GREEN: Three = { o: 2, m: 3, p: 5 };
/**
 * Error the units share, drawn once per run and applied to every unit: rework at the seams that no unit carries, the panel's
 * shared priors, and Dave's minute assumptions. From the reference-class cross-check in docs/plan/06-estimate.md: planned
 * work came in about 10 to 20% early (o), the panel puts unestimated seam work at 10 to 20% (m), and the unplanned checkout
 * epic overran by 36 to 43% (p).
 */
const SYSTEMIC: Three = { o: 0.9, m: 1.1, p: 1.5 };
/** Open fan-out units (building or waiting at the gate) per person: the work-in-progress limit in 05-execution-model.md. */
const WIP_PER_PERSON = 4;
/** The unit that sets up tiered auto-merge (ADR 0010): the App, the rulesets, the check workflows, the revert, the nightly smoke. */
const MERGE_DESK = "U-118";
/**
 * The Prototype milestone (DECISIONS 2026-10-20): a clickable guest flow on seed data with no holds, payments, or ledger.
 * The units it needs and everything they depend on: the walking skeleton and preview deploy, the database and catalog read
 * layer the pages query, seeded sessions as stand-in availability, the design system through the order summary and booking
 * bar (shown with fixture data on U-002's checkout and confirmation placeholders), home, browse, and the experience page.
 */
const PROTOTYPE = new Set(
  "U-118 U-001 U-002 U-003 U-116 U-011 U-012 U-111 U-009 U-117 U-018 U-010 U-021a U-023 U-024 U-025 U-026 U-027 U-030 U-031 U-039".split(" "),
);

interface Levers {
  /** Standard-tier fan-out units merge on a green verdict; Dave reads only critical-tier diffs and previews. */
  mergeOnGreen?: boolean;
  /** These human-led units move to fan-out. */
  toFanOut?: string[];
  /** These fan-out units move back to human-led. */
  toHuman?: string[];
  /** Dave's share of a human-led unit's elapsed days, if agents carry more of it. */
  share?: Three;
}
interface Scenario {
  name: string;
  /** Focused hours a week for each person who builds human-led units and runs the gates. */
  people: number[];
  agents: boolean;
  levers?: Levers;
  /** Open fan-out units per person, if not WIP_PER_PERSON. */
  wip?: number;
  /** "dave": Dave reads and merges every unit (artifact 5). "tiered": agents merge; critical tier via a weekly promotion. */
  merge?: "dave" | "tiered";
  /** Agents and Dave take the Prototype units before anything else. */
  prototypeFirst?: boolean;
}

/** The units the 2026-10-20 freeze decisions moved to agents: lever 2 (U-093, U-096) and lever 4a (the pattern-setters). */
const LEVER_2 = ["U-093", "U-096"];
const LEVER_4A = "U-002 U-003 U-116 U-011 U-005 U-024".split(" ");
/** Dave's share of a human-led unit before lever 3 (artifact 5). */
const SHARE_BEFORE: Three = { o: 0.5, m: 0.65, p: 0.8 };
/** The routing before the freeze decisions, for the comparison rows. */
const BEFORE_LEVERS: Levers = { toHuman: [...LEVER_2, ...LEVER_4A], share: SHARE_BEFORE };
/** Lever 4, not adopted: agents also build the money core. */
const MONEY_CORE_TO_AGENTS: Levers = { toFanOut: "U-014a U-016 U-047a U-048 U-049".split(" ") };
/** The real job keeps U-093 and U-096 human-led: the old site and real traffic are outside facts. */
const REAL_JOB: Levers = { toHuman: LEVER_2 };
const TIERED = { merge: "tiered", prototypeFirst: true, wip: 8 } as const;
const SCENARIOS: Scenario[] = [
  // Plan of record (DECISIONS 2026-10-20): the record as routed, tiered auto-merge, the Prototype first.
  { name: "Plan, Dave 10 h", people: [10], agents: true, ...TIERED },
  { name: "Plan, Dave 12.5 h", people: [12.5], agents: true, ...TIERED },
  { name: "Plan, Dave 15 h", people: [15], agents: true, ...TIERED },
  { name: "Plan, Dave 12.5 h, WIP 4", people: [12.5], agents: true, ...TIERED, wip: 4 },
  { name: "Plan, Dave 12.5 h, Prototype not first", people: [12.5], agents: true, ...TIERED, prototypeFirst: false },
  // Comparisons.
  { name: "Tiered, before the levers, Dave 12.5 h", people: [12.5], agents: true, ...TIERED, levers: BEFORE_LEVERS },
  { name: "Lever 4 too (money core to agents), Dave 12.5 h", people: [12.5], agents: true, ...TIERED, levers: MONEY_CORE_TO_AGENTS },
  { name: "Dave merges all, before the levers, 12.5 h", people: [12.5], agents: true, levers: BEFORE_LEVERS },
  { name: "Dave merges all, with the levers, 12.5 h", people: [12.5], agents: true, levers: { mergeOnGreen: true }, wip: 8 },
  // The real job's staffing options.
  { name: "One engineer full time, no agents", people: [FULL_TIME], agents: false },
  { name: "One engineer full time, agents, merges all", people: [FULL_TIME], agents: true, levers: REAL_JOB },
  { name: "One engineer full time, agents, tiered", people: [FULL_TIME], agents: true, ...TIERED, levers: REAL_JOB },
  { name: "Two engineers full time, agents, merge all", people: [FULL_TIME, FULL_TIME], agents: true, levers: REAL_JOB },
];

const report = option("report", "");
if (report !== "estimate" && report !== "resourcing" && report !== "schedule")
  throw new Error("--report estimate|resourcing|schedule is required");
const scope = option("scope", "demo");
if (scope !== "demo" && scope !== "real-job") throw new Error(`unknown --scope ${scope}`);
const withShould = flag("should");
const runs = Number(option("runs", "2000"));
const seed = Number(option("seed", "6"));
const start = option("start", "2026-10-26");
const deadline = option("deadline", "2026-12-01");
const systemicArg = option("systemic", "").split(",").map(Number);
if (systemicArg.length > 1 && (systemicArg.length !== 3 || !(systemicArg[0] <= systemicArg[1] && systemicArg[1] <= systemicArg[2])))
  throw new Error("--systemic takes three ascending numbers, O,M,P");
const systemicOf: Three = systemicArg.length === 3 ? { o: systemicArg[0], m: systemicArg[1], p: systemicArg[2] } : SYSTEMIC;

const all = await loadUnits();
const picked = selectScope(all, scope satisfies ScopeName, withShould);
if (picked.errors.length) throw new Error(picked.errors.join("; "));
const { units, deps } = picked;
const outside = [...PROTOTYPE].flatMap((id) => {
  const u = units.find((x) => x.id === id);
  if (!u) return [`${id} is not in scope`];
  return lookup(deps, id).filter((d) => !PROTOTYPE.has(d)).map((d) => `${id} needs ${d}, which is not in the Prototype`);
});
if (outside.length) throw new Error(outside.join("; "));
const missing = units.filter((u) => points3(u) === null);
if (missing.length) throw new Error(`no estimate_days on ${missing.map((u) => u.id).join(", ")}`);
const panelFile = new URL("../../docs/plan/estimate-panel.json", import.meta.url);
const panel: { units: Record<string, { solo: Three }> } = await Bun.file(panelFile).json();
const soloOf = (u: Unit): Three => {
  const s = panel.units[u.id]?.solo;
  if (!s) throw new Error(`estimate-panel.json has no solo estimate for ${u.id}`);
  return s;
};

// ---------- sampling ----------
/** mulberry32: a small seeded generator, so each block regenerates the same. */
function rng(s: number): () => number {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Gamma(shape >= 1) by Marsaglia and Tsang. */
function gamma(shape: number, r: () => number): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = r();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
/** One draw from the beta-PERT distribution over (o, m, p). */
function pert(t: Three, r: () => number): number {
  if (t.p <= t.o) return t.m;
  const a = 1 + (4 * (t.m - t.o)) / (t.p - t.o);
  const b = 1 + (4 * (t.p - t.m)) / (t.p - t.o);
  const x = gamma(a, r);
  return t.o + (t.p - t.o) * (x / (x + gamma(b, r)));
}
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

// ---------- the calendar ----------
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** The date `days` working days after the start (weekends and HOLIDAYS skipped). */
function dateAfter(days: number): string {
  const d = new Date(`${start}T12:00:00Z`);
  let left = Math.ceil(days - 1e-9);
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !HOLIDAYS.has(iso(d))) left--;
  }
  return iso(d);
}
/** Working days from the start to `date`. */
function workingDaysTo(date: string): number {
  let n = 0;
  for (let d = new Date(`${start}T12:00:00Z`); iso(d) < date; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !HOLIDAYS.has(iso(d))) n++;
  }
  return n;
}

// ---------- the graph ----------
const byId = new Map(units.map((u) => [u.id, u]));
const mean = (t: Three) => (t.o + 4 * t.m + t.p) / 6;
const plan = schedule(units, deps, (u) => mean(points3(u) as Three));
const latestStart = (id: string) => lookup(plan.es, id) + lookup(plan.slack, id);
const order = plan.order;
const dependents = plan.dependents;
const fanOutByStart = units
  .filter((u) => u.execution === "agent-fan-out")
  .sort((a, b) => lookup(plan.es, a.id) - lookup(plan.es, b.id) || a.id.localeCompare(b.id));
const approvalUnits = new Set(fanOutByStart.slice(0, 3).map((u) => u.id));

/** One run's sampled draws, shared by every scenario so their differences are not noise. */
interface Draw {
  routed: Map<string, number>;
  solo: Map<string, number>;
  uniform: Map<string, number>;
  tasks: number;
  /** The run's systemic factor. */
  k: number;
  weekly: number[];
}
function drawRun(r: () => number): Draw {
  const k = pert(systemicOf, r);
  const routed = new Map<string, number>();
  const solo = new Map<string, number>();
  const uniform = new Map<string, number>();
  for (const u of units) {
    routed.set(u.id, k * pert(points3(u) as Three, r));
    solo.set(u.id, k * pert(soloOf(u), r));
    uniform.set(u.id, r());
  }
  const tasks = sum(DAVE_TASKS.filter((t) => t.scope === "demo" && t.phase === "P5").map((t) => t.minutes));
  return {
    routed,
    solo,
    uniform,
    tasks: pert(tasks, r) / 60,
    k,
    weekly: Array.from({ length: 3 }, () => r()),
  };
}
/** The triangular quantile of a three-point figure at `u`, so a unit's minutes and share move together across scenarios. */
const at = (t: Three, u: number) => (u < 0.5 ? t.o + (t.m - t.o) * Math.sqrt(2 * u) : t.p - (t.p - t.m) * Math.sqrt(2 * (1 - u)));

/** Unconstrained finish: every owner full time and free; returns the finish and the zero-slack units of the run. */
function floorRun(d: Map<string, number>): { finish: number; critical: string[]; prototype: number } {
  const ef = new Map<string, number>();
  const via = new Map<string, string | null>();
  for (const id of order) {
    let s = 0;
    let p: string | null = null;
    for (const x of lookup(deps, id)) if (lookup(ef, x) > s) [s, p] = [lookup(ef, x), x];
    ef.set(id, s + lookup(d, id));
    via.set(id, p);
  }
  let last = order[0];
  for (const id of order) if (lookup(ef, id) > lookup(ef, last)) last = id;
  const critical: string[] = [];
  for (let id: string | null = last; id; id = lookup(via, id)) critical.push(id);
  return { finish: lookup(ef, last), critical, prototype: Math.max(...[...PROTOTYPE].map((id) => lookup(ef, id))) };
}

interface Job {
  id: string;
  hours: number;
  rank: number;
  then: () => void;
}
interface Outcome {
  finish: number;
  /** When every Prototype unit is on `main`. */
  prototype: number;
  hands: number;
  gates: number;
  other: number;
  idle: number;
  /** When each unit started: its build, or its owner's first hour on it. */
  starts: Map<string, number>;
  /** When each unit merged. */
  ends: Map<string, number>;
  /** Hours worked by the people, by week from the start. */
  weekly: number[];
}

/** One run of a scenario: people as servers who take gates first, then their own units, at their weekly hours. */
function simulate(sc: Scenario, draw: Draw): Outcome {
  const lev = sc.levers ?? {};
  const toFanOut = new Set(lev.toFanOut ?? []);
  const toHuman = new Set(lev.toHuman ?? []);
  const share3 = lev.share ?? DAVE_SHARE;
  const shareOf = (u: Unit) => (u.execution === "human-only" ? 1 : at(share3, draw.uniform.get(u.id) ?? 0.5));
  const route = (u: Unit) =>
    !sc.agents ? "solo" : toHuman.has(u.id) ? "human-led" : toFanOut.has(u.id) ? "agent-fan-out" : u.execution;
  // Tiered auto-merge switches on when the merge desk unit merges; anything merged before it goes through Dave.
  const tiered = sc.merge === "tiered" && sc.agents;
  let tieredOn = false;
  let switchOnAt = Infinity;
  const gateOf = (u: Unit): number => {
    let terms = tieredOn ? tieredGateTerms(u) : gateTerms(u, approvalUnits.has(u.id));
    if (!tieredOn && lev.mergeOnGreen && u.review !== "critical") terms = { ...terms, "verdict and merge": MERGE_ON_GREEN };
    let t = sum(Object.values(terms));
    t = add(t, peopleMinutes(u));
    return (draw.k * at(t, draw.uniform.get(u.id) ?? 0.5)) / 60;
  };

  const waiting = new Map(units.map((u) => [u.id, lookup(deps, u.id).length]));
  const finish = new Map<string, number>();
  const builds: { id: string; end: number; then: () => void }[] = [];
  const gates: Job[] = [];
  const own: Job[] = [];
  const queued: Unit[] = [];
  const wip = (sc.wip ?? WIP_PER_PERSON) * sc.people.length;
  let inFlight = 0;
  const current: (Job | null)[] = sc.people.map(() => null);
  const starts = new Map<string, number>();
  const out: Outcome = { finish: 0, prototype: 0, hands: 0, gates: 0, other: 0, idle: 0, starts, ends: finish, weekly: [] };
  let t = 0;
  let open = units.length;

  // Under tiered auto-merge a critical-tier unit lands on `integration`, where its dependents build on it, and reaches
  // `main` in Dave's next weekly promotion; the launch review waits until nothing is left on `integration`.
  const onMain = new Map<string, number>();
  const unbatched: Unit[] = [];
  const awaiting = new Set<string>();
  let launchWaiting: Unit | null = null;
  const promote = () => {
    const batch = unbatched.splice(0);
    if (!batch.length) return;
    const minutes = sum([PROMOTION, ...batch.filter((u) => route(u) === "agent-fan-out").map(batchReadMinutes)]);
    gates.push({
      id: "promotion",
      hours: (draw.k * at(minutes, draw.uniform.get(batch[0].id) ?? 0.5)) / 60,
      rank: -1,
      then: () => {
        for (const u of batch) {
          onMain.set(u.id, t);
          awaiting.delete(u.id);
        }
        if (launchWaiting && !awaiting.size) {
          const u = launchWaiting;
          launchWaiting = null;
          release(u);
        }
      },
    });
  };
  const done = (id: string) => {
    finish.set(id, t);
    open--;
    const u = lookup(byId, id);
    if (tieredOn && u.review === "critical") {
      unbatched.push(u);
      awaiting.add(id);
    } else onMain.set(id, t);
    if (tiered && id === MERGE_DESK) switchOnAt = t;
    for (const x of lookup(dependents, id)) {
      const n = lookup(waiting, x) - 1;
      waiting.set(x, n);
      if (n === 0) release(lookup(byId, x));
    }
  };
  const rankOf = (id: string) => latestStart(id) - (sc.prototypeFirst && PROTOTYPE.has(id) ? 1000 : 0);
  // Fan-out units start in order of least latest start while the work-in-progress limit allows.
  const startBuilds = () => {
    queued.sort((a, b) => rankOf(a.id) - rankOf(b.id));
    while (inFlight < wip && queued.length) {
      const u = queued.shift() as Unit;
      inFlight++;
      if (!starts.has(u.id)) starts.set(u.id, t);
      builds.push({
        id: u.id,
        end: t + lookup(draw.routed, u.id),
        then: () =>
          gates.push({
            id: u.id,
            hours: gateOf(u),
            rank: rankOf(u.id),
            then: () => {
              inFlight--;
              done(u.id);
            },
          }),
      });
    }
  };
  const release = (u: Unit) => {
    if (u.id === LAUNCH_REVIEW && awaiting.size) {
      launchWaiting = u;
      promote();
      return;
    }
    const r = route(u);
    if (r === "agent-fan-out") queued.push(u);
    else if (r === "solo") {
      own.push({ id: u.id, hours: lookup(draw.solo, u.id) * DAY_HOURS + at(peopleMinutes(u), 0.5) / 60, rank: rankOf(u.id), then: () => done(u.id) });
    } else {
      const d = lookup(draw.routed, u.id);
      const s = shareOf(u);
      own.push({
        id: u.id,
        hours: s * d * DAY_HOURS + at(CLOSE, 0.5) / 60,
        rank: rankOf(u.id),
        then: () => builds.push({ id: u.id, end: t + (1 - s) * d, then: () => done(u.id) }),
      });
    }
  };

  // Account tasks at the start; recurring work each week (bookkeeping always, CI triage after U-105, a release after U-103).
  gates.push({ id: "tasks", hours: draw.tasks, rank: -1, then: () => {} });
  const weeklyJob = (week: number) => {
    let h = at(BOOKKEEPING, draw.weekly[0]) / 60;
    if (finish.has("U-105")) h += at(CI_TRIAGE, draw.weekly[1]) / 60;
    if (finish.has("U-103")) h += at(RELEASE, draw.weekly[2]) / 60;
    gates.push({ id: `week ${week}`, hours: h, rank: -1, then: () => {} });
  };
  for (const u of units) if (lookup(waiting, u.id) === 0) release(u);

  let week = 0;
  const cap = sc.people.map((h) => (h / 5) * DT);
  while (open > 0) {
    if (t > 2000) throw new Error(`${sc.name}: no finish after 2000 working days`);
    if (Math.floor(t / 5 + 1e-9) > week) {
      week++;
      weeklyJob(week);
      promote();
    }
    if (t >= switchOnAt) tieredOn = true;
    startBuilds();
    for (let i = builds.length - 1; i >= 0; i--)
      if (builds[i].end <= t + 1e-9) {
        const b = builds.splice(i, 1)[0];
        b.then();
      }
    for (let p = 0; p < sc.people.length; p++) {
      let left = cap[p];
      while (left > 1e-9) {
        let job: Job | null = null;
        let isGate = false;
        if (gates.length) {
          gates.sort((a, b) => a.rank - b.rank);
          job = gates[0];
          isGate = true;
        } else if (current[p]) job = current[p];
        else if (own.length) {
          own.sort((a, b) => a.rank - b.rank);
          job = own.shift() ?? null;
          current[p] = job;
          if (job && !starts.has(job.id)) starts.set(job.id, t);
        }
        if (!job) {
          out.idle += left;
          break;
        }
        const work = Math.min(left, job.hours);
        const wk = Math.floor(t / 5 + 1e-9);
        out.weekly[wk] = (out.weekly[wk] ?? 0) + work;
        job.hours -= work;
        left -= work;
        if (isGate) {
          if (job.id === "tasks" || job.id.startsWith("week ")) out.other += work;
          else out.gates += work;
        } else out.hands += work;
        if (job.hours <= 1e-9) {
          if (isGate) gates.shift();
          else current[p] = null;
          job.then();
        }
      }
    }
    t += DT;
  }
  out.finish = Math.max(...finish.values());
  out.prototype = Math.max(...[...PROTOTYPE].map((id) => onMain.get(id) ?? lookup(finish, id)));
  return out;
}

// ---------- output ----------
const md: string[] = [];
const line = (s = "") => md.push(s);
const f1 = (n: number) => n.toFixed(1);
const weeks = (days: number) => f1(days / 5);
const cmd = `bun scripts/plan/forecast.ts --report ${report}${scope !== "demo" ? ` --scope ${scope}` : ""}${withShould ? " --should" : ""} --runs ${runs} --seed ${seed} --start ${start}${systemicArg.length === 3 ? ` --systemic ${systemicArg.join(",")}` : ""}`;
line(
  `Generated by \`${cmd}\`. Do not edit by hand. Working days skip weekends and ${[...HOLIDAYS].join(", ")}. Systemic factor per run: ${systemicOf.o} / ${systemicOf.m} / ${systemicOf.p}.`,
);
line();
const r = rng(seed);
const draws = Array.from({ length: runs }, () => drawRun(r));
const floors = draws.map((d) => floorRun(d.routed));
const soloFloors = draws.map((d) => floorRun(d.solo));
const deadlineDays = workingDaysTo(deadline);

if (report === "estimate") {
  const totals = draws.map((d) => [...d.routed.values()].reduce((a, x) => a + x, 0));
  const soloTotals = draws.map((d) => [...d.solo.values()].reduce((a, x) => a + x, 0));
  const fin = floors.map((x) => x.finish);
  const sumMeans = units.reduce((a, u) => a + mean(points3(u) as Three), 0);
  const humanLed = units.filter((u) => u.execution !== "agent-fan-out");
  const sumOf = (xs: Unit[]) => xs.reduce((a, u) => a + mean(points3(u) as Three), 0);
  line(`| Measure (${units.length} units in scope \`${scope}${withShould ? "+should" : ""}\`) | P10 | P50 | P90 |`);
  line(`|---|---|---|---|`);
  line(`| Total work as routed, days | ${f1(quantile(totals, 0.1))} | ${f1(quantile(totals, 0.5))} | ${f1(quantile(totals, 0.9))} |`);
  line(`| Total work solo (one engineer, no agents), days | ${f1(quantile(soloTotals, 0.1))} | ${f1(quantile(soloTotals, 0.5))} | ${f1(quantile(soloTotals, 0.9))} |`);
  line(`| Graph finish, every owner full time and free, working days | ${f1(quantile(fin, 0.1))} | ${f1(quantile(fin, 0.5))} | ${f1(quantile(fin, 0.9))} |`);
  line(`| The same, in weeks | ${weeks(quantile(fin, 0.1))} | ${weeks(quantile(fin, 0.5))} | ${weeks(quantile(fin, 0.9))} |`);
  line(`| The same, as a date from ${start} | ${dateAfter(quantile(fin, 0.1))} | ${dateAfter(quantile(fin, 0.5))} | ${dateAfter(quantile(fin, 0.9))} |`);
  const proto = floors.map((x) => x.prototype);
  line(
    `| The Prototype (${PROTOTYPE.size} units) on the same terms, weeks | ${weeks(quantile(proto, 0.1))} | ${weeks(quantile(proto, 0.5))} | ${weeks(quantile(proto, 0.9))} |`,
  );
  line();
  line(
    `Sum of the three-point means: ${f1(sumMeans)} days as routed, of which the ${humanLed.length} human-led units carry ${f1(sumOf(humanLed))} and the ${units.length - humanLed.length} fan-out units ${f1(sumMeans - sumOf(humanLed))}. The single PERT path (critical-path.ts) is ${f1(plan.length)} days of means; the simulated P50 is later for two reasons. The graph has many near-tied chains, and the latest of several uncertain chains runs later than any one of them (merge bias). And each run scales every unit by the systemic factor, error the units share that a sum of independent units hides. ${runs} runs. Chance the floor alone makes ${deadline} (${deadlineDays} working days): ${Math.round((fin.filter((x) => x <= deadlineDays).length / runs) * 100)}%.`,
  );
  line();
  const hits = new Map<string, number>();
  for (const x of floors) for (const id of x.critical) hits.set(id, (hits.get(id) ?? 0) + 1);
  const ranked = [...hits].filter(([, n]) => n / runs >= 0.1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  line(`**Criticality** (share of runs in which the unit is on the longest chain; units at 10% or more):`);
  line();
  line(`| Unit | Title | Route | o / m / p days | Critical in |`);
  line(`|---|---|---|---|---|`);
  for (const [id, n] of ranked) {
    const u = lookup(byId, id);
    const e = points3(u) as Three;
    line(`| ${id} | ${u.title} | ${u.execution} | ${e.o} / ${e.m} / ${e.p} | ${Math.round((n / runs) * 100)}% |`);
  }
} else if (report === "resourcing") {
  line(`| Scenario | Prototype, weeks (P10 / P50 / P90) | Prototype P50 / P90 date | Finish, weeks (P10 / P50 / P90) | Finish P50 / P90 date | Bound by people or WIP | Hours a week used (P50) |`);
  line(`|---|---|---|---|---|---|---|`);
  const detail: string[] = [];
  for (const sc of SCENARIOS) {
    const outs = draws.map((d) => simulate(sc, d));
    const fin = outs.map((o) => o.finish);
    const proto = outs.map((o) => o.prototype);
    const floor = sc.agents ? floors : soloFloors;
    const bound = outs.filter((o, i) => o.finish > floor[i].finish * BOUND_RATIO).length;
    const busy = outs.map((o) => (o.hands + o.gates + o.other) / (o.finish / 5) / sc.people.length);
    line(
      `| ${sc.name} | ${weeks(quantile(proto, 0.1))} / ${weeks(quantile(proto, 0.5))} / ${weeks(quantile(proto, 0.9))} | ${dateAfter(quantile(proto, 0.5))} / ${dateAfter(quantile(proto, 0.9))} | ${weeks(quantile(fin, 0.1))} / ${weeks(quantile(fin, 0.5))} / ${weeks(quantile(fin, 0.9))} | ${dateAfter(quantile(fin, 0.5))} / ${dateAfter(quantile(fin, 0.9))} | ${Math.round((bound / runs) * 100)}% | ${f1(quantile(busy, 0.5))} of ${sc.people[0]} |`,
    );
    const q = (k: keyof Outcome) => f1(quantile(outs.map((o) => o[k]), 0.5));
    detail.push(`| ${sc.name} | ${q("hands")} | ${q("gates")} | ${q("other")} | ${q("idle")} |`);
  }
  line();
  line(`**Where the people's hours go** (P50 of each term over the runs, total hours across everyone; idle is capacity with nothing ready):`);
  line();
  line(`| Scenario | Own units | Gates and people checks | Tasks and weekly work | Idle |`);
  line(`|---|---|---|---|---|`);
  for (const x of detail) line(x);
  line();
  line(
    `Hours are Dave's focused hours a week; an engineer full time is ${FULL_TIME}. Tiered: auto-merge as ADR 0010 amended it on 2026-10-20, switched on when ${MERGE_DESK} (the merge desk) merges; no fan-out unit merges before it. Standard-tier units merge to \`main\` on the agents' verdicts. Critical-tier units merge to \`integration\`, and their dependents build on them there. Dave reads their diffs in a weekly promotion batch, and the launch review waits for the last promotion. Before the switch, and in the "merges all" rows, Dave reads and merges every unit. Tiered rows take the Prototype first and allow 8 open fan-out units unless the row says otherwise. Prototype: ${[...PROTOTYPE].join(", ")}, all on \`main\`. No row reaches ${deadline}. The plan rows run the record as routed, which carries the freeze decisions: lever 2 (${LEVER_2.join(", ")} built by agents, with Dave's results read as a people check), lever 3 (Dave's share of each unit he leads ${DAVE_SHARE.o} / ${DAVE_SHARE.m} / ${DAVE_SHARE.p}), and lever 4a (${LEVER_4A.join(", ")} built by agents). "Before the levers" moves those units back to Dave at his earlier share of ${SHARE_BEFORE.o} / ${SHARE_BEFORE.m} / ${SHARE_BEFORE.p}. "Lever 4 too" also hands the money core to agents (not adopted). "With the levers" in a merges-all row adds lever 1: standard-tier units merge on a green verdict. The real-job rows keep U-093 and U-096 with the lead. A unit moved to fan-out keeps its days and gets the full gate, critical-tier read included. WIP: open fan-out units, building or at the gate. Bound: the run finishes more than ${Math.round((BOUND_RATIO - 1) * 100)}% later than the same draws with every owner full time and free. The work-in-progress limit is ${WIP_PER_PERSON} open fan-out units per person unless the row says otherwise. ${runs} runs per scenario, the same draws in every scenario.`,
  );
}

if (report === "schedule") {
  // P50 of each unit's start and finish over the runs: a planning view, so the units' P50s need not chain exactly.
  const names = option("scenarios", "Plan, Dave 12.5 h|Tiered, before the levers, Dave 12.5 h").split("|");
  const pick = (k: number[]) => ({ p10: quantile(k, 0.1), p50: quantile(k, 0.5), p90: quantile(k, 0.9) });
  const dated = (q: { p10: number; p50: number; p90: number }) => ({
    weeks: { p10: +f1(q.p10 / 5), p50: +f1(q.p50 / 5), p90: +f1(q.p90 / 5) },
    dates: { p10: dateAfter(q.p10), p50: dateAfter(q.p50), p90: dateAfter(q.p90) },
  });
  const scenarios = names.map((name) => {
    const sc = SCENARIOS.find((s) => s.name === name);
    if (!sc) throw new Error(`no scenario named "${name}"`);
    const toFanOut = new Set(sc.levers?.toFanOut ?? []);
    const toHuman = new Set(sc.levers?.toHuman ?? []);
    const outs = draws.map((d) => simulate(sc, d));
    const weeksLong = Math.max(...outs.map((o) => o.weekly.length));
    return {
      name,
      hoursPerWeek: sc.people[0],
      prototype: dated(pick(outs.map((o) => o.prototype))),
      finish: dated(pick(outs.map((o) => o.finish))),
      peopleHoursByWeek: Array.from({ length: weeksLong }, (_, w) => +f1(quantile(outs.map((o) => o.weekly[w] ?? 0), 0.5))),
      units: units.map((u) => {
        const s = quantile(outs.map((o) => lookup(o.starts, u.id)), 0.5);
        const e = quantile(outs.map((o) => lookup(o.ends, u.id)), 0.5);
        return {
          id: u.id,
          builtBy: !toHuman.has(u.id) && (u.execution === "agent-fan-out" || toFanOut.has(u.id)) ? "agents" : "Dave",
          start: +f1(s),
          end: +f1(e),
          startDate: dateAfter(s),
          endDate: dateAfter(e),
        };
      }),
    };
  });
  const json = {
    generated: `bun scripts/plan/forecast.ts --report schedule --runs ${runs} --seed ${seed} --start ${start}`,
    start,
    deadline,
    runs,
    sprints: Array.from({ length: Math.ceil(Math.max(...scenarios.map((s) => s.peopleHoursByWeek.length)) / 2) }, (_, k) => ({
      sprint: k + 1,
      startDay: k * SPRINT_DAYS,
      endDay: (k + 1) * SPRINT_DAYS,
      startDate: dateAfter(k * SPRINT_DAYS),
      endDate: dateAfter((k + 1) * SPRINT_DAYS - 1),
    })),
    floor: dated(pick(floors.map((x) => x.finish))),
    prototypeFloor: dated(pick(floors.map((x) => x.prototype))),
    units: units.map((u) => ({
      id: u.id,
      title: u.title,
      section: u.section,
      priority: u.priority,
      review: u.review,
      complexity: u.complexity,
      uncertainty: u.uncertainty,
      days: points3(u),
      prototype: PROTOTYPE.has(u.id),
      dependsOn: lookup(deps, u.id),
    })),
    scenarios,
  };
  const out = option("out", "");
  if (!out) throw new Error("--report schedule needs --out FILE");
  await Bun.write(out, `${JSON.stringify(json, null, 1)}\n`);
  console.error(`wrote ${out}`);
  process.exit(0);
}

const output = md.join("\n");
const target = option("write", "");
if (target) {
  const block = `${report}${scope !== "demo" ? `-${scope}` : ""}${withShould ? "+should" : ""}`;
  await writeBlock(target, "forecast", block, output);
  console.error(`wrote block ${block} to ${target}`);
} else {
  console.log(output);
}
