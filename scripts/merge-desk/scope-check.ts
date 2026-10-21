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

  // 3. The title names a unit, or is PM bookkeeping.
  const title = input.title.replace(/^(Revert: )+/, "");
  const bookkeeping = title.startsWith("PM bookkeeping:");
  const unitId = title.match(/^(U-[0-9]+[a-z]*)(?![0-9A-Za-z])/)?.[1];
  if (!bookkeeping && (!unitId || !units.has(unitId))) {
    return fail(`Title must start with a unit ID from units.yaml (for example "U-118: …") or "PM bookkeeping:". Got: ${input.title}`);
  }

  // 4. Protected paths. Bookkeeping may touch three plan files, and only into main.
  if (bookkeeping) {
    if (base !== "main") return fail("A bookkeeping PR must target main.");
    const stray = changedFiles.filter((file) => !BOOKKEEPING_FILES.includes(file));
    if (stray.length > 0) {
      return fail(`A bookkeeping PR may touch only ${BOOKKEEPING_FILES.join(", ")}. Also changed: ${stray.join(", ")}`);
    }
    return pass("Bookkeeping PR touches only the plan record files.");
  }
  const touched = changedFiles.filter((file) => PROTECTED.some((path) => file === path || file.startsWith(path)));
  if (touched.length > 0) return fail(`Protected paths changed (Dave edits these): ${touched.join(", ")}`);

  // 5. Tier.
  const tier = units.get(unitId!)!;
  if (tier === "critical" && base !== "integration") {
    return fail(`${unitId} is critical tier and must target integration, not ${base}.`);
  }
  if (tier === "standard" && base === "main" && input.carriesIntegrationCommits) {
    return fail(`${unitId} carries commits that are on integration and not on main; it must target integration so nothing reaches main around the promotion.`);
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
    let onIntegration: string[] = [];
    try {
      onIntegration = lines(git(["rev-list", "origin/integration", "^origin/main"]));
    } catch {
      // no integration branch yet
    }
    const verdict = checkScope({
      title: PR_TITLE,
      base: BASE_REF,
      head: HEAD_REF,
      changedFiles: git(["diff", "--name-only", "-z", "--no-renames", `${base}...${PR_HEAD}`]).split("\0").filter(Boolean),
      units: parseUnits(readFileSync("docs/plan/units.yaml", "utf8")),
      carriesIntegrationCommits: onIntegration.some((sha) => onMain.has(sha)),
      aheadOfMain: onMain.size > 0,
    });
    console.log(verdict.reason);
    process.exit(verdict.ok ? 0 : 1);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
