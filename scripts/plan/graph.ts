// The dependency graph over units.yaml: record checks, scope selection, weights, and the forward and backward pass.
// Shared by critical-path.ts (artifact 4), execution-model.ts (artifact 5), and the estimate and resourcing scripts after them.

import { lookup, type Unit } from "./units";

/** The launch review waits for every unit in scope. */
export const LAUNCH_REVIEW = "U-104";

export type ScopeName = "demo" | "real-job";
export type WeightName = "pert" | "points" | "count";

/** The units a scope covers, their in-scope dependencies, and why the rest are out. */
export interface Scope {
  units: Unit[];
  deps: Map<string, string[]>;
  excluded: { unit: Unit; reason: string }[];
  metInP4: string[];
  syntheticEdges: string[];
  errors: string[];
}

/** One pass of the critical path method over a scope. */
export interface Schedule {
  order: string[];
  dependents: Map<string, string[]>;
  weight: Map<string, number>;
  es: Map<string, number>;
  ef: Map<string, number>;
  slack: Map<string, number>;
  level: Map<string, number>;
  length: number;
  /** The chains shown: the path first, then ties chosen so every zero-slack unit appears on one, up to CHAIN_CAP. */
  chains: string[][];
  /** Every zero-slack chain, up to ENUMERATION_CAP. */
  allChains: string[][];
  /** How many zero-slack chains there are, counted without a cap. */
  chainCount: number;
  path: string[];
  descendants: Map<string, Set<string>>;
  isCritical: (id: string) => boolean;
}

/** Dave's share of a human-led unit's elapsed time (o, m, p): lever 3, agents carry half (DECISIONS 2026-10-20); an assumption until P5 logs dave_minutes. */
export const DAVE_SHARE = { o: 0.35, m: 0.5, p: 0.65 };

const EPS = 1e-9;
/** The most zero-slack chains shown, so a wide tie stays readable. */
export const CHAIN_CAP = 8;
/** The most zero-slack chains enumerated, for sums over every tie. */
const ENUMERATION_CAP = 5000;

/**
 * Topological order over `ids`; ids in a cycle are left out and reported through `onCycle`.
 */
export function topoOrder(ids: string[], deps: (id: string) => string[], onCycle: (stuck: string[]) => void = () => {}): string[] {
  const inSet = new Set(ids);
  const indeg = new Map(ids.map((id) => [id, 0]));
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const id of ids)
    for (const d of deps(id))
      if (inSet.has(d)) {
        indeg.set(id, lookup(indeg, id) + 1);
        lookup(out, d).push(id);
      }
  const queue = ids.filter((id) => indeg.get(id) === 0).sort();
  const order: string[] = [];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    order.push(id);
    for (const s of lookup(out, id)) {
      indeg.set(s, lookup(indeg, s) - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }
  if (order.length !== ids.length) onCycle(ids.filter((id) => !order.includes(id)));
  return order;
}

/** Errors in the whole record: duplicate IDs, missing dependencies, Must-on-Should and phase inversions, cycles. */
export function checkRecord(all: Unit[]): string[] {
  const errors: string[] = [];
  const byId = new Map(all.map((u) => [u.id, u]));
  const seen = new Set<string>();
  for (const u of all) {
    if (seen.has(u.id)) errors.push(`duplicate id ${u.id}`);
    seen.add(u.id);
    for (const d of u.depends_on) if (!byId.has(d)) errors.push(`${u.id} depends on missing ${d}`);
  }
  const rank = { Foundation: 0, Must: 0, Should: 1 } as const;
  const phaseRank = { P4: 0, P5: 1, "post-launch": 2 } as const;
  for (const u of all)
    for (const d of u.depends_on) {
      const v = byId.get(d);
      if (!v) continue;
      if (rank[v.priority] > rank[u.priority])
        errors.push(`${u.id} (${u.priority}) depends on ${d} (Should): cutting ${d} would strand it`);
      if (phaseRank[v.phase] > phaseRank[u.phase]) errors.push(`${u.id} (${u.phase}) depends on ${d} (${v.phase})`);
    }
  topoOrder(
    all.map((u) => u.id),
    (id) => lookup(byId, id).depends_on.filter((d) => byId.has(d)),
    (stuck) => errors.push(`cycle among ${stuck.join(", ")}`),
  );
  return errors;
}

/**
 * Selects a scope. P4 units count as met; post-launch units form the tail; the launch review gains an edge
 * from every in-scope unit that is not already upstream of it and that nothing else in scope needs.
 */
export function selectScope(all: Unit[], scope: ScopeName, withShould: boolean): Scope {
  const byId = new Map(all.map((u) => [u.id, u]));
  const priorities = new Set(["Foundation", "Must", ...(withShould ? ["Should"] : [])]);
  const modes = new Set(scope === "real-job" ? ["both", "real-job"] : ["both"]);
  const reason = (u: Unit): string | null => {
    if (u.phase === "P4") return "P4 (done before the plan freeze; dependencies on it count as met)";
    if (u.phase === "post-launch") return "post-launch (legacy-retirement tail, reported below)";
    if (!modes.has(u.mode)) return "estimated, not built in the demo";
    if (!priorities.has(u.priority)) return "Should (first in the cut order; run with --should)";
    return null;
  };
  const units = all.filter((u) => reason(u) === null);
  const inScope = new Set(units.map((u) => u.id));
  const excluded = all.flatMap((u) => {
    const r = reason(u);
    return r === null ? [] : [{ unit: u, reason: r }];
  });
  const errors: string[] = [];
  const metInP4 = new Set<string>();
  const deps = new Map<string, string[]>();
  for (const u of units) {
    const kept: string[] = [];
    for (const d of u.depends_on) {
      const v = byId.get(d);
      if (inScope.has(d)) kept.push(d);
      else if (v?.phase === "P4") metInP4.add(d);
      else errors.push(`${u.id} is in scope but depends on ${d}, which is not (${v ? reason(v) : "missing"})`);
    }
    deps.set(u.id, kept);
  }
  const syntheticEdges: string[] = [];
  if (inScope.has(LAUNCH_REVIEW)) {
    const upstream = new Set<string>();
    const walk = (id: string) => {
      for (const d of lookup(deps, id))
        if (!upstream.has(d)) {
          upstream.add(d);
          walk(d);
        }
    };
    walk(LAUNCH_REVIEW);
    const needed = new Set(units.flatMap((u) => lookup(deps, u.id)));
    for (const u of units)
      if (u.id !== LAUNCH_REVIEW && !upstream.has(u.id) && !needed.has(u.id)) {
        lookup(deps, LAUNCH_REVIEW).push(u.id);
        syntheticEdges.push(`${u.id} → ${LAUNCH_REVIEW}`);
      }
  }
  return { units, deps, excluded, metInP4: [...metInP4].sort(), syntheticEdges, errors };
}

/** The three points of a unit's estimate, or null while any is missing. */
export function points3(u: Unit): { o: number; m: number; p: number } | null {
  const e = u.estimate_days;
  return e && typeof e.o === "number" && typeof e.m === "number" && typeof e.p === "number" ? { o: e.o, m: e.m, p: e.p } : null;
}

/** pert once every unit in scope has an estimate, else points; an explicit name wins. */
export function resolveWeight(requested: string, units: Unit[]): WeightName {
  const all = units.every((u) => points3(u) !== null);
  if (requested === "auto") return all ? "pert" : "points";
  if (requested === "pert" && !all)
    throw new Error(
      `--weight pert needs estimate_days on every unit in scope; missing on ${units.filter((u) => points3(u) === null).length}`,
    );
  if (requested !== "pert" && requested !== "points" && requested !== "count") throw new Error(`unknown --weight ${requested}`);
  return requested;
}

/** A unit's weight: the three-point mean in days, its complexity in points, or 1. */
export function weightOf(u: Unit, name: WeightName): number {
  const e = points3(u);
  if (name === "count") return 1;
  if (name === "points" || e === null) return u.complexity;
  return (e.o + 4 * e.m + e.p) / 6;
}

/** The three-point variance, ((p - o) / 6)², in pert mode; 0 otherwise. */
export function varianceOf(u: Unit, name: WeightName): number {
  const e = points3(u);
  return name === "pert" && e ? ((e.p - e.o) / 6) ** 2 : 0;
}

/** Forward and backward pass: earliest start and finish, slack, the zero-slack chains, and transitive dependents. */
export function schedule(units: Unit[], deps: Map<string, string[]>, weight: (u: Unit) => number): Schedule {
  const order = topoOrder(
    units.map((u) => u.id),
    (id) => lookup(deps, id),
  );
  const dependents = new Map<string, string[]>(units.map((u) => [u.id, []]));
  for (const u of units) for (const d of lookup(deps, u.id)) lookup(dependents, d).push(u.id);
  const w = new Map(units.map((u) => [u.id, weight(u)]));
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  const level = new Map<string, number>();
  for (const id of order) {
    const ds = lookup(deps, id);
    es.set(id, Math.max(0, ...ds.map((d) => lookup(ef, d))));
    ef.set(id, lookup(es, id) + lookup(w, id));
    level.set(id, ds.length ? Math.max(...ds.map((d) => lookup(level, d) + 1)) : 0);
  }
  const length = Math.max(0, ...units.map((u) => lookup(ef, u.id)));
  const ls = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const ss = lookup(dependents, id);
    const lf = ss.length ? Math.min(...ss.map((s) => lookup(ls, s))) : length;
    ls.set(id, lf - lookup(w, id));
  }
  const slack = new Map(units.map((u) => [u.id, Math.max(0, lookup(ls, u.id) - lookup(es, u.id))]));
  const isCritical = (id: string) => lookup(slack, id) < EPS;

  const tightPreds = (id: string) =>
    lookup(deps, id)
      .filter((d) => isCritical(d) && Math.abs(lookup(ef, d) - lookup(es, id)) < EPS)
      .sort();
  const ends = units
    .filter((u) => isCritical(u.id) && Math.abs(lookup(ef, u.id) - length) < EPS)
    .map((u) => u.id)
    .sort();
  const chainsTo = new Map<string, number>();
  for (const id of order) {
    if (!isCritical(id)) continue;
    const ps = tightPreds(id);
    chainsTo.set(id, ps.length ? ps.reduce((a, p) => a + (chainsTo.get(p) ?? 0), 0) : 1);
  }
  const chainCount = ends.reduce((a, e) => a + (chainsTo.get(e) ?? 0), 0);
  const allChains: string[][] = [];
  const back = (id: string, tail: string[]) => {
    if (allChains.length >= ENUMERATION_CAP) return;
    const preds = tightPreds(id);
    if (!preds.length) {
      allChains.push([id, ...tail]);
      return;
    }
    for (const p of preds) back(p, [id, ...tail]);
  };
  for (const e of ends) back(e, []);
  // Show the path, then greedily the tie that covers the most zero-slack units not yet shown.
  const chains: string[][] = allChains.length ? [allChains[0]] : [];
  const covered = new Set(chains.flat());
  while (chains.length < CHAIN_CAP) {
    let best: string[] | null = null;
    let gain = 0;
    for (const c of allChains) {
      const g = c.filter((id) => !covered.has(id)).length;
      if (g > gain) {
        best = c;
        gain = g;
      }
    }
    if (!best) break;
    chains.push(best);
    for (const id of best) covered.add(id);
  }

  const descendants = new Map<string, Set<string>>();
  for (const id of [...order].reverse()) {
    const set = new Set<string>();
    for (const s of lookup(dependents, id)) {
      set.add(s);
      for (const x of lookup(descendants, s)) set.add(x);
    }
    descendants.set(id, set);
  }
  return {
    order,
    dependents,
    weight: w,
    es,
    ef,
    slack,
    level,
    length,
    chains,
    allChains,
    chainCount,
    path: chains[0] ?? [],
    descendants,
    isCritical,
  };
}

/** The schedule with one Dave: units that need him run one at a time. */
export interface LevelledSchedule {
  start: Map<string, number>;
  finish: Map<string, number>;
  length: number;
  daveOrder: string[];
  daveBusy: number;
}

/**
 * List schedule with Dave as a resource of capacity 1. Units where `needsDave` is false start as soon as their
 * dependencies finish. A unit that needs Dave holds him for `share(unit)` of its weight (1: the whole unit; less: agents
 * carry the rest after he hands off) and finishes after its full weight. When he is free, he takes the ready unit with the lowest
 * latest start in the unconstrained `plan` (then the least slack, then the ID), and idles when none is ready.
 * @throws on a cycle
 */
export function levelledSchedule(
  units: Unit[],
  deps: Map<string, string[]>,
  weight: Map<string, number>,
  plan: Schedule,
  needsDave: (u: Unit) => boolean,
  share: (u: Unit) => number = () => 1,
): LevelledSchedule {
  const start = new Map<string, number>();
  const finish = new Map<string, number>();
  const pending = new Set(units.map((u) => u.id));
  const byId = new Map(units.map((u) => [u.id, u]));
  const daveOrder: string[] = [];
  let daveFree = 0;
  const readyAt = (id: string) => {
    const ds = lookup(deps, id);
    return ds.every((d) => finish.has(d)) ? Math.max(0, ...ds.map((d) => lookup(finish, d))) : null;
  };
  const latestStart = (id: string) => lookup(plan.es, id) + lookup(plan.slack, id);
  while (pending.size) {
    let progress = true;
    while (progress) {
      progress = false;
      for (const id of [...pending]) {
        const r = readyAt(id);
        if (r === null || needsDave(lookup(byId, id))) continue;
        start.set(id, r);
        finish.set(id, r + lookup(weight, id));
        pending.delete(id);
        progress = true;
      }
    }
    const ready = [...pending].flatMap((id) => {
      const r = readyAt(id);
      return r === null ? [] : [{ id, r }];
    });
    if (!ready.length) {
      if (pending.size) throw new Error(`levelled schedule stuck on ${[...pending].join(", ")}`);
      break;
    }
    const at = Math.max(daveFree, Math.min(...ready.map((x) => x.r)));
    const pick = ready
      .filter((x) => x.r <= at)
      .sort(
        (a, b) => latestStart(a.id) - latestStart(b.id) || lookup(plan.slack, a.id) - lookup(plan.slack, b.id) || a.id.localeCompare(b.id),
      )[0];
    start.set(pick.id, at);
    finish.set(pick.id, at + lookup(weight, pick.id));
    daveFree = at + share(lookup(byId, pick.id)) * lookup(weight, pick.id);
    daveOrder.push(pick.id);
    pending.delete(pick.id);
  }
  const daveBusy = daveOrder.reduce((a, id) => a + share(lookup(byId, id)) * lookup(weight, id), 0);
  return { start, finish, length: Math.max(0, ...finish.values()), daveOrder, daveBusy };
}
