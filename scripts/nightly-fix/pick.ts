// Picks the one audit ticket the nightly fix agent works tonight (ADR 0011). Deterministic: the agent never chooses.
// Prints JSON for the workflow ({ skip } or { issue, unit, tier, branch, title, file }). Reads issues and PRs only.
// Run: GH_TOKEN=... bun scripts/nightly-fix/pick.ts
import { readFileSync } from "node:fs";
import { PROTECTED, parseUnits, readTitle, type Tier } from "../merge-desk/scope-check.ts";

export const REPO = "defaultdave/ramble";
/** The App that files audit tickets. A ticket from anyone else could carry instructions, so it is never picked. */
export const TICKET_AUTHOR = "app/defaultdave-agents";
export const OPT_IN_LABEL = "nightly-fix";
/** Tickets filed by the bug finder (ADR 0012) have no source PR, so they name their unit themselves. */
export const FINDER_LABEL = "finder";
const BLOCKING_LABELS = ["needs-owner"];
/** Files that steer required checks or the rules (issue 999). The agent never edits them, so a ticket citing one is Dave's. */
export const OFF_LIMITS = [
  ...PROTECTED,
  ".gitleaks",
  "package.json",
  "pnpm-lock.yaml",
  "vitest.config",
  "knip.json",
  "playwright.config",
  "scripts/test-size.ts",
  "src/server/db/migrations/",
];

export interface Issue {
  number: number;
  title: string;
  body: string;
  author: string;
  labels: string[];
}

export type Pick =
  | { skip: string }
  | { issue: number; unit: string; tier: Tier; branch: string; title: string; file: string };

export const isOffLimits = (path: string) => OFF_LIMITS.some((prefix) => path === prefix || path.startsWith(prefix));

/** The file the ticket's first line cites, as `path:line`. */
export function citedFile(body: string): string | null {
  return body.match(/^`([^`:\s]+)(?::[0-9-]+)?`/)?.[1] ?? null;
}

/** The PR the finding came from: `- From: 967` or `- From: PR 905`. */
export function sourcePr(body: string): number | null {
  const found = body.match(/^- From: (?:PR )?([0-9]+)\s*$/m)?.[1];
  return found ? Number(found) : null;
}

/** The unit a finder ticket names: `- Unit: U-077`. Read only from an App ticket labelled `finder`. */
export function unitLine(body: string): string | null {
  return body.match(/^- Unit: (U-[0-9]+[a-z]*)\s*$/m)?.[1] ?? null;
}

export interface PickInput {
  issues: Issue[];
  /** Head branches of every open PR. */
  openBranches: string[];
  /** Source PR number -> its title, for the PRs the candidate tickets came from. */
  prTitles: Map<number, string>;
  units: Map<string, Tier>;
}

export function pick(input: PickInput): Pick {
  if (input.openBranches.some((branch) => branch.includes("-nightly-"))) {
    return { skip: "a nightly fix PR is still open; one at a time" };
  }
  const candidates = input.issues
    .filter((issue) => issue.author === TICKET_AUTHOR && issue.labels.includes(OPT_IN_LABEL))
    .filter((issue) => !issue.labels.some((label) => BLOCKING_LABELS.includes(label)))
    .sort((a, b) => a.number - b.number);
  const reasons: string[] = [];
  for (const issue of candidates) {
    const file = citedFile(issue.body);
    const from = sourcePr(issue.body);
    const finder = issue.labels.includes(FINDER_LABEL);
    const unit = from ? readTitle(input.prTitles.get(from) ?? "").unitId : finder ? (unitLine(issue.body) ?? undefined) : undefined;
    const tier = unit ? input.units.get(unit) : undefined;
    if (!file) reasons.push(`#${issue.number}: no cited file`);
    else if (isOffLimits(file)) reasons.push(`#${issue.number}: ${file} is off limits`);
    else if (!unit || !tier) reasons.push(`#${issue.number}: no unit from its source PR or Unit line`);
    else {
      const short = issue.title.replace(/^[A-Z]+[0-9]*-[0-9]+\s+/, "").slice(0, 60).trim();
      return { issue: issue.number, unit, tier, file, branch: `unit/${unit}-nightly-${issue.number}`, title: `${unit}: ${short} (#${issue.number})` };
    }
  }
  return { skip: candidates.length ? `no ticket qualifies (${reasons.join("; ")})` : `no open audit ticket labelled ${OPT_IN_LABEL}` };
}

function gh(args: string[]): unknown {
  const result = Bun.spawnSync(["gh", ...args, "--repo", REPO], { stdout: "pipe", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`gh ${args[0]} ${args[1]} failed (exit ${result.exitCode})`);
  return JSON.parse(result.stdout.toString());
}

if (import.meta.main) {
  const rawIssues = gh(["issue", "list", "--state", "open", "--label", "audit", "--label", OPT_IN_LABEL, "--limit", "100", "--json", "number,title,body,author,labels"]) as {
    number: number; title: string; body: string; author: { login: string }; labels: { name: string }[];
  }[];
  const issues: Issue[] = rawIssues.map((i) => ({ ...i, author: i.author.login, labels: i.labels.map((l) => l.name) }));
  const openBranches = (gh(["pr", "list", "--state", "open", "--limit", "200", "--json", "headRefName"]) as { headRefName: string }[]).map((p) => p.headRefName);
  const prTitles = new Map<number, string>();
  for (const from of new Set(issues.map((i) => sourcePr(i.body)).filter((n): n is number => n !== null))) {
    prTitles.set(from, (gh(["pr", "view", String(from), "--json", "title"]) as { title: string }).title);
  }
  const units = parseUnits(readFileSync("docs/plan/units.yaml", "utf8"));
  console.log(JSON.stringify(pick({ issues, openBranches, prTitles, units })));
}
