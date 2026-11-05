// The `scope-manifest` check (runbook B1). Reads git metadata and the units record only; it never runs
// code from the PR. Env: PR_TITLE, BASE_REF, HEAD_REF, PR_HEAD (a local ref for the PR head).
import { readFileSync } from "node:fs";

export const PROTECTED = [".github/", ".claude/", "CLAUDE.md", "scripts/merge-desk/", "docs/adr/", "docs/plan/"];
export const BOOKKEEPING_FILES = ["docs/plan/units.yaml", "docs/plan/STATUS.md", "docs/plan/delta-log.md"];

export type Tier = "standard" | "critical";
export type Verdict = { ok: true; reason: string } | { ok: false; reason: string };

export interface ScopeInput {
  title: string;
  base: string;
  head: string;
  /** Files changed by the PR (git diff --name-only base...head). */
  changedFiles: string[];
  /** Unit id -> review tier, from units.yaml. */
  units: Map<string, Tier>;
  /** units.yaml before (base) and after (PR head); needed only when a bookkeeping PR changes it. */
  unitsYaml?: { base: string; head: string };
}

/** Reads each unit's id and review tier from the parsed YAML. No review field means standard; anything other than "standard" is treated as critical. */
export function parseUnits(yaml: string): Map<string, Tier> {
  const units = new Map<string, Tier>();
  for (const unit of parseUnitsFile(yaml).units ?? []) {
    units.set(String(unit.id), unit.review === undefined || unit.review === "standard" ? "standard" : "critical");
  }
  return units;
}

const fail = (reason: string): Verdict => ({ ok: false, reason });
const pass = (reason: string): Verdict => ({ ok: true, reason });

/** Unit fields a bookkeeping PR may change (Dave's rule): progress and actuals, never the plan. */
export const BOOKKEEPING_FIELDS = ["status", "actual_days", "dave_minutes", "tokens", "note"];

type UnitRecord = Record<string, unknown>;
type UnitsFile = Record<string, unknown> & { units?: UnitRecord[] };

/** Parses the YAML itself, so flow-style or otherwise unusual entries cannot hide inside a line-based reading. */
function parseUnitsFile(yaml: string): UnitsFile {
  const parsed: unknown = Bun.YAML.parse(yaml);
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as UnitsFile).units)) {
    throw new Error("units.yaml must be a mapping with a units list");
  }
  return parsed as UnitsFile;
}

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

/** Lists what a bookkeeping edit of units.yaml changed beyond BOOKKEEPING_FIELDS. Empty means allowed. */
export function unitsYamlViolations(before: string, after: string): string[] {
  const a = parseUnitsFile(before);
  const b = parseUnitsFile(after);
  const problems: string[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key !== "units" && !same(a[key], b[key])) problems.push(`top-level ${key}`);
  }
  const x = a.units ?? [];
  const y = b.units ?? [];
  if (!same(x.map((unit) => unit.id), y.map((unit) => unit.id))) problems.push("units were added, removed, or reordered");
  else {
    x.forEach((unit, index) => {
      for (const field of new Set([...Object.keys(unit), ...Object.keys(y[index])])) {
        if (!BOOKKEEPING_FIELDS.includes(field) && !same(unit[field], y[index][field])) problems.push(`${unit.id}.${field}`);
      }
    });
  }
  return problems;
}

/** What a PR title says it is: a unit's PR (or the revert of one), or PM bookkeeping. */
export function readTitle(prTitle: string): { revert: boolean; bookkeeping: boolean; unitId?: string } {
  const title = prTitle.replace(/^(Revert: )+/, "");
  return {
    revert: /^Revert: /.test(prTitle),
    bookkeeping: title.startsWith("PM bookkeeping:"),
    unitId: title.match(/^(U-[0-9]+[a-z]*)(?![0-9A-Za-z])/)?.[1],
  };
}

const UNIT_BRANCH = /^unit\/(U-[0-9]+[a-z]*)(?:-|$)/;
const REVERT_BRANCH = /^revert\/pr-[0-9]+$/;
const lower = (path: string) => path.toLowerCase();

export function checkScope(input: ScopeInput): Verdict {
  const { base, head, changedFiles, units } = input;

  // 1. Every PR targets main; the review tier decides who reads it (the human-read check), not where it lands.
  if (base !== "main") return fail(`Base must be main, not ${base}.`);

  // 2. The title names a unit, or is PM bookkeeping. Branch and title must agree, so a title cannot pick the tier.
  const { revert, bookkeeping, unitId } = readTitle(input.title);
  if (!bookkeeping && (!unitId || !units.has(unitId))) {
    return fail(`Title must start with a unit ID from units.yaml (for example "U-118: …") or "PM bookkeeping:". Got: ${input.title}`);
  }
  if (revert) {
    // revert.sh names its branch revert/pr-N. The check cannot see the reverted PR, so the unit ID in the
    // title (copied from that PR) sets the tier, and a critical unit's revert waits for the human read too.
    if (!REVERT_BRANCH.test(head)) return fail(`A revert PR must come from a revert/pr-<number> branch, not ${head}.`);
  } else if (!bookkeeping) {
    const branchUnit = head.match(UNIT_BRANCH)?.[1];
    if (branchUnit !== unitId) {
      return fail(`Branch ${head} must be unit/${unitId}[-suffix] to match the title's unit ${unitId}.`);
    }
  }

  // 3. Protected paths. Bookkeeping may touch three plan files.
  if (bookkeeping) {
    const stray = changedFiles.filter((file) => !BOOKKEEPING_FILES.includes(file));
    if (stray.length > 0) {
      return fail(`A bookkeeping PR may touch only ${BOOKKEEPING_FILES.join(", ")}. Also changed: ${stray.join(", ")}`);
    }
    if (changedFiles.includes("docs/plan/units.yaml")) {
      if (!input.unitsYaml) return fail("Bookkeeping changed units.yaml but its before and after text was not supplied.");
      const problems = unitsYamlViolations(input.unitsYaml.base, input.unitsYaml.head);
      if (problems.length > 0) {
        return fail(`A bookkeeping PR may change only ${BOOKKEEPING_FIELDS.join(", ")} in units.yaml. Also changed: ${problems.join(", ")}`);
      }
    }
    return pass("Bookkeeping PR touches only the plan record files.");
  }
  // Compared case-insensitively: a macOS checkout treats Docs/Plan and docs/plan as one folder.
  const touched = changedFiles.filter((file) => PROTECTED.some((path) => lower(file) === lower(path) || lower(file).startsWith(lower(path))));
  if (touched.length > 0) return fail(`Protected paths changed (Dave edits these): ${touched.join(", ")}`);

  return pass(`${unitId} (${units.get(unitId!)}) into main.`);
}

function git(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
}

const lines = (text: string) => text.split("\n").filter(Boolean);

if (import.meta.main) {
  try {
    const { PR_TITLE = "", BASE_REF = "", HEAD_REF = "", PR_HEAD = "pr-head" } = process.env;
    if (!BASE_REF || !HEAD_REF) throw new Error("BASE_REF and HEAD_REF are required");
    const base = `origin/${BASE_REF}`;
    const changedFiles = git(["diff", "--name-only", "-z", "--no-renames", `${base}...${PR_HEAD}`]).split("\0").filter(Boolean);
    const unitsYaml = changedFiles.includes("docs/plan/units.yaml")
      ? { base: git(["show", `${base}:docs/plan/units.yaml`]), head: git(["show", `${PR_HEAD}:docs/plan/units.yaml`]) }
      : undefined;
    const verdict = checkScope({
      title: PR_TITLE,
      base: BASE_REF,
      head: HEAD_REF,
      changedFiles,
      units: parseUnits(readFileSync("docs/plan/units.yaml", "utf8")),
      unitsYaml,
    });
    console.log(verdict.reason);
    process.exit(verdict.ok ? 0 : 1);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
