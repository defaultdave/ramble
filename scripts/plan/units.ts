// Shared types and helpers for the plan scripts over docs/plan/units.yaml (P4 artifacts 4 to 7).

/** Three-point estimate in days; null until artifact 6. */
export type Estimate = { o: number | null; m: number | null; p: number | null };

/** Who builds a unit (ADR 0010, P4 artifact 5). */
export type Execution = "human-only" | "human-led" | "agent-fan-out";

/** How hard a fan-out unit is reviewed before Dave merges it (P4 artifact 5). */
export type ReviewTier = "standard" | "critical";

/** One entry in units.yaml. */
export interface Unit {
  id: string;
  title: string;
  section: string;
  slice: string;
  priority: "Foundation" | "Must" | "Should";
  prd: number[];
  scope: string;
  phase: "P4" | "P5" | "post-launch";
  mode: "both" | "real-job";
  complexity: 1 | 2 | 3;
  uncertainty: 1 | 2 | 3;
  spike: boolean;
  depends_on: string[];
  execution: Execution | null;
  execution_reason?: string;
  review?: ReviewTier;
  /** A check only a person can run, with Dave's minutes for it. */
  acceptance_by_people?: { what: string; minutes: { o: number; m: number; p: number } };
  estimate_days: Estimate | null;
  actual_days: number | null;
  dave_minutes: number | null;
  tokens: number | null;
  status: string;
  note?: string;
}

/** The record; `UNITS_FILE` points the scripts at a copy, for what-if runs. */
export const UNITS_PATH = process.env.UNITS_FILE
  ? new URL(`file://${process.env.UNITS_FILE}`)
  : new URL("../../docs/plan/units.yaml", import.meta.url);

/** True when a parsed entry has the fields the plan scripts read. */
function isUnit(x: unknown): x is Unit {
  if (typeof x !== "object" || x === null) return false;
  const u = x as Record<string, unknown>;
  return (
    typeof u.id === "string" &&
    typeof u.title === "string" &&
    typeof u.section === "string" &&
    [1, 2, 3].includes(u.complexity as number) &&
    [1, 2, 3].includes(u.uncertainty as number) &&
    Array.isArray(u.depends_on) &&
    u.depends_on.every((d) => typeof d === "string")
  );
}

/**
 * Reads and parses units.yaml.
 * @throws when the file is not a list of units, naming the first bad entry
 */
export async function loadUnits(): Promise<Unit[]> {
  const data: unknown = Bun.YAML.parse(await Bun.file(UNITS_PATH).text());
  const units = typeof data === "object" && data !== null && "units" in data ? data.units : null;
  if (!Array.isArray(units)) throw new Error(`${UNITS_PATH.pathname} has no units list`);
  const bad = units.findIndex((u) => !isUnit(u));
  if (bad >= 0) throw new Error(`${UNITS_PATH.pathname}: entry ${bad} is missing id, title, section, scores, or depends_on`);
  return units as Unit[];
}

/**
 * Reads a key that must be present.
 * @throws when the key is missing, naming it
 */
export function lookup<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`missing key ${String(key)}`);
  return value;
}

/** Command-line option `--name value`, or the fallback. */
export function option(name: string, fallback: string): string {
  const argv = Bun.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  const value = argv[i + 1];
  return i >= 0 && value !== undefined && !value.startsWith("--") ? value : fallback;
}

/** Command-line flag `--name`. */
export function flag(name: string): boolean {
  return Bun.argv.slice(2).includes(`--${name}`);
}

/**
 * Replaces the text between `<!-- PREFIX:BLOCK:start -->` and `<!-- PREFIX:BLOCK:end -->` in a file.
 * @throws when the file has no such block
 */
export async function writeBlock(target: string, prefix: string, block: string, content: string): Promise<void> {
  const text = await Bun.file(target).text();
  const start = `<!-- ${prefix}:${block}:start -->`;
  const end = `<!-- ${prefix}:${block}:end -->`;
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i < 0 || j < i) throw new Error(`${target} has no ${start} ... ${end} block`);
  await Bun.write(target, `${text.slice(0, i + start.length)}\n${content}\n${text.slice(j)}`);
}

/**
 * Longest chain of predecessors for each unit (0 for a root), over the dependencies among the given units.
 * @throws on a cycle
 */
export function depths(units: Unit[]): Map<string, number> {
  const ids = new Set(units.map((u) => u.id));
  const byId = new Map(units.map((u) => [u.id, u]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) throw new Error(`cycle through ${id}`);
    visiting.add(id);
    const preds = lookup(byId, id).depends_on.filter((d) => ids.has(d));
    const value = preds.length ? Math.max(...preds.map((d) => visit(d) + 1)) : 0;
    visiting.delete(id);
    depth.set(id, value);
    return value;
  };
  for (const u of units) visit(u.id);
  return depth;
}
