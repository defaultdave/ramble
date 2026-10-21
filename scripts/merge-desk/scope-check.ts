// The `scope-manifest` check (runbook B1). Reads git metadata and the units record only; it never runs
// code from the PR. Env: PR_TITLE, BASE_REF, HEAD_REF, PR_HEAD (a local ref for the PR head).
import { readFileSync } from "node:fs";

export const PROMOTION_MESSAGE = "Promotion: Dave merges with bypass after the nightly smoke (runbook E1).";
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
  /** True when the head carries commits that are on integration and not on main. */
  carriesIntegrationCommits: boolean;
  /** True when the head has commits that are not already on main (used for sync PRs). */
  aheadOfMain: boolean;
  /** units.yaml before (base) and after (PR head); needed only when a bookkeeping PR changes it. */
  unitsYaml?: { base: string; head: string };
}

/** Reads each unit's id and review tier without a YAML library. A unit with no review line is standard. */
export function parseUnits(yaml: string): Map<string, Tier> {
  const units = new Map<string, Tier>();
  let current: string | null = null;
  for (const line of yaml.split("\n")) {
    const id = line.match(/^ {2}- id: (\S+)\s*$/);
    if (id) {
      current = id[1];
      units.set(current, "standard");
      continue;
    }
    const review = line.match(/^ {4}review: (standard|critical)\s*$/);
    if (review && current) units.set(current, review[1] as Tier);
  }
  return units;
}

const fail = (reason: string): Verdict => ({ ok: false, reason });
const pass = (reason: string): Verdict => ({ ok: true, reason });

/** Unit fields a bookkeeping PR may change (Dave's rule): progress and actuals, never the plan. */
export const BOOKKEEPING_FIELDS = ["status", "actual_days", "dave_minutes", "tokens", "note"];

/** Splits units.yaml into its header and, per unit, the text of each 4-space-indented field. */
function unitFields(yaml: string): { header: string; order: string[]; fields: Map<string, Map<string, string>> } {
  const fields = new Map<string, Map<string, string>>();
  const order: string[] = [];
  const header: string[] = [];
  let unit: Map<string, string> | null = null;
  let key: string | null = null;
  for (const line of yaml.split("\n")) {
    const id = line.match(/^ {2}- id: (\S+)\s*$/);
    if (id) {
      unit = new Map([["id", line]]);
      fields.set(id[1], unit);
      order.push(id[1]);
      key = "id";
      continue;
    }
    if (!unit) {
      header.push(line);
      continue;
    }
    const field = line.match(/^ {4}([A-Za-z_]+):/);
    if (field) key = field[1];
    unit.set(key!, `${unit.get(key!) ?? ""}${unit.has(key!) ? "\n" : ""}${line}`);
  }
  return { header: header.join("\n"), order, fields };
}

/** Lists what a bookkeeping edit of units.yaml changed beyond BOOKKEEPING_FIELDS. Empty means allowed. */
export function unitsYamlViolations(before: string, after: string): string[] {
  const a = unitFields(before);
  const b = unitFields(after);
  const problems: string[] = [];
  if (a.header !== b.header) problems.push("the file header changed");
  if (a.order.join(",") !== b.order.join(",")) problems.push("units were added, removed, or reordered");
  for (const id of a.order) {
    const x = a.fields.get(id);
    const y = b.fields.get(id);
    if (!x || !y) continue;
    for (const field of new Set([...x.keys(), ...y.keys()])) {
      if (BOOKKEEPING_FIELDS.includes(field)) continue;
      if (x.get(field) !== y.get(field)) problems.push(`${id}.${field}`);
    }
  }
  return problems;
}

const UNIT_BRANCH = /^unit\/(U-[0-9]+[a-z]*)(?:-|$)/;
const REVERT_BRANCH = /^revert\/pr-[0-9]+$/;
const lower = (path: string) => path.toLowerCase();

export function checkScope(input: ScopeInput): Verdict {
  const { base, head, changedFiles, units } = input;

  // 1. Promotion PRs always fail; Dave merges them with bypass.
  if (head === "integration" && base === "main") return fail(PROMOTION_MESSAGE);

  // 2. Sync PRs (main into integration) pass, provided the head adds nothing beyond main.
  if (base === "integration" && (head === "main" || head.startsWith("sync/"))) {
    return input.aheadOfMain
      ? fail(`Sync PR: ${head} has commits that are not on main; a sync branch must be main itself.`)
      : pass("Sync PR: brings main into integration.");
  }

  // 3. The title names a unit, or is PM bookkeeping. Branch and title must agree, so a title cannot pick the tier.
  const revert = /^Revert: /.test(input.title);
  const title = input.title.replace(/^(Revert: )+/, "");
  const bookkeeping = title.startsWith("PM bookkeeping:");
  const unitId = title.match(/^(U-[0-9]+[a-z]*)(?![0-9A-Za-z])/)?.[1];
  if (!bookkeeping && (!unitId || !units.has(unitId))) {
    return fail(`Title must start with a unit ID from units.yaml (for example "U-118: …") or "PM bookkeeping:". Got: ${input.title}`);
  }
  if (revert) {
    // revert.sh names its branch revert/pr-N. The check cannot see the reverted PR, so the unit ID in the
    // title (copied from that PR) sets the tier; rule 5 then keeps a critical unit's revert off main.
    if (!REVERT_BRANCH.test(head)) return fail(`A revert PR must come from a revert/pr-<number> branch, not ${head}.`);
  } else if (!bookkeeping) {
    const branchUnit = head.match(UNIT_BRANCH)?.[1];
    if (branchUnit !== unitId) {
      return fail(`Branch ${head} must be unit/${unitId}[-suffix] to match the title's unit ${unitId}.`);
    }
  }

  // Integration's unpromoted commits must never reach main around the promotion, whatever the PR is.
  if (base === "main" && input.carriesIntegrationCommits) {
    return fail("The branch carries commits that are on integration and not on main; it must target integration so nothing reaches main around the promotion.");
  }

  // 4. Protected paths. Bookkeeping may touch three plan files, and only into main.
  if (bookkeeping) {
    if (base !== "main") return fail("A bookkeeping PR must target main.");
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

  // 5. Tier.
  const tier = units.get(unitId!)!;
  if (tier === "critical" && base !== "integration") {
    return fail(`${unitId} is critical tier and must target integration, not ${base}.`);
  }
  if (tier === "standard" && base !== "main" && base !== "integration") {
    return fail(`Base must be main or integration, not ${base}.`);
  }
  return pass(`${unitId} (${tier}) into ${base}.`);
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
    const onMain = new Set(lines(git(["rev-list", PR_HEAD, "^origin/main"])));
    // Only a missing integration branch means "no integration commits"; any other git error fails the check.
    const probe = Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", "origin/integration"], { stdout: "pipe", stderr: "pipe" });
    if (probe.exitCode !== 0 && (probe.exitCode !== 1 || probe.stderr.toString().trim() !== "")) {
      throw new Error(`git rev-parse origin/integration failed: ${probe.stderr.toString().trim()}`);
    }
    const onIntegration = probe.exitCode === 0 ? lines(git(["rev-list", "origin/integration", "^origin/main"])) : [];
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
      carriesIntegrationCommits: onIntegration.some((sha) => onMain.has(sha)),
      aheadOfMain: onMain.size > 0,
      unitsYaml,
    });
    console.log(verdict.reason);
    process.exit(verdict.ok ? 0 : 1);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
