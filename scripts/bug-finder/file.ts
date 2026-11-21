// Files the bug finder's one finding as an issue, as the App (ADR 0012). The finding is data from an agent, so
// every field is validated and the issue is built from fields; nothing in it is ever run or trusted as an instruction.
// Never adds the `nightly-fix` label: that is the owner's opt-in.
// Run: bun scripts/bug-finder/file.ts <dir holding finding.json and verdict.md> <area slug>
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mintToken } from "../merge-desk/app-token.ts";
import { parseUnits } from "../merge-desk/scope-check.ts";
import { citedFile, FINDER_LABEL, isOffLimits, REPO } from "../nightly-fix/pick.ts";

export const LENSES = ["bug", "a11y", "performance", "visual", "rules"] as const;
export const SIZES = ["XS", "S", "M", "L"] as const;
const KINDS = ["bug", "improvement"] as const;
const TITLE_LIMIT = 120;
const TEXT_LIMIT = 4000;

export interface Finding {
  kind: (typeof KINDS)[number];
  lens: (typeof LENSES)[number];
  title: string;
  file: string;
  /** `62` or `62-71`. */
  lines: string;
  unit: string;
  size: (typeof SIZES)[number];
  /** A failing test, a Playwright repro, or the input that breaks the cited line. */
  evidence: string;
  fix: string;
  /** For an improvement: the PRD requirement or blocking rule it fails. */
  requirement: string | null;
}

export type Parsed = { finding: Finding } | { none: string } | { invalid: string };

const FILE_PATH = /^[A-Za-z0-9_@()[\].-]+(?:\/[A-Za-z0-9_@()[\].-]+)*$/;

/** Free text for an issue body: capped, line endings normalised, and `@name` defanged so it notifies no one. */
export function plain(value: string, limit = TEXT_LIMIT): string {
  return value.replace(/\r\n?/g, "\n").trim().slice(0, limit).replace(/@(?=[A-Za-z0-9])/g, "@​");
}

const oneLine = (value: string) => plain(value.replace(/\s+/g, " "), TITLE_LIMIT);

export function parseFinding(raw: unknown): Parsed {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { invalid: "finding.json is not an object" };
  const f = raw as Record<string, unknown>;
  const str = (key: string) => (typeof f[key] === "string" ? (f[key] as string).trim() : "");
  if ("none" in f) return str("none") ? { none: plain(str("none")) } : { invalid: "`none` must say what was checked" };

  const kind = KINDS.find((k) => k === f.kind);
  const lens = LENSES.find((l) => l === f.lens);
  const size = SIZES.find((s) => s === f.size);
  const lines = String(f.lines ?? "").trim();
  const file = str("file");
  if (!kind) return { invalid: `kind must be one of ${KINDS.join(", ")}` };
  if (!lens) return { invalid: `lens must be one of ${LENSES.join(", ")}` };
  if (!size) return { invalid: `size must be one of ${SIZES.join(", ")}` };
  if (!str("title")) return { invalid: "title is empty" };
  if (!FILE_PATH.test(file) || file.includes("..")) return { invalid: `file is not a repo-relative path: ${file.slice(0, 80)}` };
  if (!/^[0-9]+(-[0-9]+)?$/.test(lines)) return { invalid: "lines must be `62` or `62-71`" };
  if (!/^U-[0-9]+[a-z]*$/.test(str("unit"))) return { invalid: "unit must look like U-077" };
  if (!str("evidence")) return { invalid: "a finding needs evidence" };
  if (!str("fix")) return { invalid: "a finding needs a fix suggestion" };
  if (kind === "improvement" && !str("requirement")) return { invalid: "an improvement must cite a requirement or blocking rule" };
  return {
    finding: {
      kind, lens, size, file, lines,
      title: oneLine(str("title")),
      unit: str("unit"),
      evidence: plain(str("evidence")),
      fix: plain(str("fix")),
      requirement: str("requirement") ? oneLine(str("requirement")) : null,
    },
  };
}

/** The verifier's final message starts with exactly CONFIRMED or REFUTED; anything else files nothing. */
export function readVerdict(text: string): "CONFIRMED" | "REFUTED" | "NO-VERDICT" {
  const first = text.split("\n")[0]?.trim();
  return first === "CONFIRMED" || first === "REFUTED" ? first : "NO-VERDICT";
}

export interface KnownIssue {
  number: number;
  title: string;
  body: string;
}

const normalise = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The line range a ticket's first line cites, `` `path:62-71` ``. */
function citedLines(body: string): [number, number] | null {
  const found = body.match(/^`[^`:\s]+:([0-9]+)(?:-([0-9]+))?`/);
  return found ? [Number(found[1]), Number(found[2] ?? found[1])] : null;
}

/** An open or closed ticket on the same lines of the same file, or with the same title. */
export function findDuplicate(finding: Finding, known: KnownIssue[]): number | null {
  const [start, end] = finding.lines.split("-").map(Number) as [number, number?];
  const last = end ?? start;
  const title = normalise(finding.title);
  const match = known.find((issue) => {
    if (normalise(issue.title) === title) return true;
    const lines = citedLines(issue.body);
    return citedFile(issue.body) === finding.file && lines !== null && lines[0] <= last && start <= lines[1];
  });
  return match?.number ?? null;
}

export interface BodyContext {
  area: string;
  runUrl: string;
  unitKnown: boolean;
  offLimits: boolean;
}

/** The record format the picker reads: the first line cites `path:line`, and `- Unit:` names the unit. */
export function issueBody(finding: Finding, ctx: BodyContext): string {
  return [
    `\`${finding.file}:${finding.lines}\`: ${finding.title}`,
    ...(ctx.unitKnown ? [`- Unit: ${finding.unit}`] : []),
    `- Area: ${ctx.area}`,
    `- Lens: ${finding.lens}`,
    `- Kind: ${finding.kind}`,
    `- Size: ${finding.size}`,
    "- Status when filed: open",
    ...(ctx.unitKnown ? [] : [`- The finder named ${finding.unit}, which is not in docs/plan/units.yaml, so the owner assigns the unit.`]),
    ...(ctx.offLimits ? [`- ${finding.file} is off limits to the nightly fix agent, so this ticket is the owner's.`] : []),
    "",
    "**Evidence**",
    "",
    finding.evidence,
    "",
    "**Suggested fix**",
    "",
    finding.fix,
    ...(finding.requirement ? ["", "**Requirement or rule it fails**", "", finding.requirement] : []),
    "",
    "---",
    `Filed by the bug finder (ADR 0012), run ${ctx.runUrl}. An independent read-only agent tried to refute this from the evidence and could not. The nightly fix agent takes it only after the owner adds the \`nightly-fix\` label.`,
  ].join("\n");
}

export type Decision =
  | { action: "stop"; why: string }
  | { action: "file"; title: string; body: string; labels: string[] };

export interface DecideInput {
  parsed: Parsed;
  verdict: ReturnType<typeof readVerdict>;
  known: KnownIssue[];
  unitIds: Set<string>;
  area: string;
  runUrl: string;
  fileExists: (path: string) => boolean;
}

export function decide(input: DecideInput): Decision {
  const { parsed } = input;
  if ("none" in parsed) return { action: "stop", why: `nothing filed. Checked: ${parsed.none}` };
  if ("invalid" in parsed) return { action: "stop", why: `nothing filed: the finding was rejected (${parsed.invalid})` };
  const { finding } = parsed;
  if (input.verdict !== "CONFIRMED") return { action: "stop", why: `nothing filed: the verifier said ${input.verdict} for "${finding.title}"` };
  if (!input.fileExists(finding.file)) return { action: "stop", why: `nothing filed: ${finding.file} is not in the repository` };
  const duplicate = findDuplicate(finding, input.known);
  if (duplicate) return { action: "stop", why: `nothing filed: "${finding.title}" duplicates #${duplicate}` };
  const unitKnown = input.unitIds.has(finding.unit);
  const offLimits = isOffLimits(finding.file);
  return {
    action: "file",
    title: finding.title,
    body: issueBody(finding, { area: input.area, runUrl: input.runUrl, unitKnown, offLimits }),
    labels: ["audit", FINDER_LABEL, ...(offLimits || !unitKnown ? ["needs-owner"] : [])],
  };
}

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

/** Every audit ticket, open and closed. The issues endpoint also lists PRs, which are skipped. */
export async function listKnown(token: string, doFetch: typeof fetch = fetch): Promise<KnownIssue[]> {
  const known: KnownIssue[] = [];
  for (let page = 1; page <= 20; page++) {
    const response = await doFetch(`https://api.github.com/repos/${REPO}/issues?state=all&labels=audit&per_page=100&page=${page}`, { headers: headers(token) });
    if (!response.ok) throw new Error(`GitHub refused the issue list: HTTP ${response.status}`);
    const batch = (await response.json()) as (KnownIssue & { pull_request?: unknown })[];
    known.push(...batch.filter((issue) => !issue.pull_request).map(({ number, title, body }) => ({ number, title, body: body ?? "" })));
    if (batch.length < 100) break;
  }
  return known;
}

export async function createIssue(decision: Extract<Decision, { action: "file" }>, token: string, doFetch: typeof fetch = fetch): Promise<number> {
  const response = await doFetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ title: decision.title, body: decision.body, labels: decision.labels }),
  });
  if (!response.ok) throw new Error(`GitHub refused the issue: HTTP ${response.status}`);
  return ((await response.json()) as { number: number }).number;
}

const readOr = (path: string, fallback: string) => (existsSync(path) ? readFileSync(path, "utf8") : fallback);

if (import.meta.main) {
  try {
    const [dir, area] = process.argv.slice(2);
    if (!dir || !area) throw new Error("usage: bun scripts/bug-finder/file.ts <dir> <area slug>");
    const runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY ?? REPO}/actions/runs/${process.env.GITHUB_RUN_ID ?? "local"}`;
    let raw: unknown;
    try {
      raw = JSON.parse(readOr(join(dir, "finding.json"), "{}"));
    } catch {
      raw = null;
    }
    const base = {
      parsed: parseFinding(raw),
      verdict: readVerdict(readOr(join(dir, "verdict.md"), "")),
      unitIds: new Set(parseUnits(readFileSync("docs/plan/units.yaml", "utf8")).keys()),
      area,
      runUrl,
      fileExists: existsSync,
    };
    // The App token is minted only when there is something to file.
    const needsGithub = "finding" in base.parsed && base.verdict === "CONFIRMED";
    const token = needsGithub ? await mintToken() : "";
    const decision = decide({ ...base, known: needsGithub ? await listKnown(token) : [] });
    let summary: string;
    if (decision.action === "stop") summary = decision.why;
    else summary = `filed #${await createIssue(decision, token)}: ${decision.title} (${decision.labels.join(", ")})`;
    const line = `### Bug finder, area ${area}\n${summary}\n`;
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
