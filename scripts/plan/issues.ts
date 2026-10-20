#!/usr/bin/env bun
// Mirrors units.yaml to GitHub at the plan freeze (ADR 0010): one issue per unit, carrying its scope manifest, added to
// the "Ramble" project board with the fields filled from the record. units.yaml stays the record.
//
// Run: bun scripts/plan/issues.ts            print what it would create (no GitHub calls beyond reads)
//      bun scripts/plan/issues.ts --run      create the issues and fill the board (Dave runs this; gate 5)
// Skips the P4 spikes (done) and any unit whose issue already exists, so a second run picks up where one stopped.

import { flag, loadUnits, type Unit } from "./units";

const REPO = "defaultdave/ramble";
const OWNER = "defaultdave";
const BOARD = 19;
/** Pause between units, to stay under GitHub's limits on creating content. */
const PAUSE_MS = 1500;

const run = flag("run");

/**
 * Runs `gh` with the given arguments and returns its stdout.
 * @throws when gh exits non-zero, with its stderr
 */
function gh(args: string[]): string {
  const p = Bun.spawnSync(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${p.stderr.toString().trim()}`);
  return p.stdout.toString().trim();
}

/** The issue body: the unit's scope manifest and where it sits in the plan. */
function body(u: Unit): string {
  const e = u.estimate_days;
  return [
    "SCOPE MANIFEST",
    `IN SCOPE: ${u.scope}`,
    "OUT OF SCOPE: anything the line above does not name, including other units' scope (docs/plan/units.yaml); adjacent ideas go in the PR's Suggestions section, not in code.",
    "REFERENCE CODE: docs/plan/01-design-doc.md and the ADRs in docs/adr/ for contracts and conventions; Cat Pass is reference only (ADR 0009).",
    "",
    `- Section: ${u.section} (${u.slice}); priority ${u.priority}${u.prd.length ? `; PRD ${u.prd.map((n) => `PRD-${n}`).join(", ")}` : ""}`,
    `- Depends on: ${u.depends_on.length ? u.depends_on.join(", ") : "nothing"}`,
    `- Built by: ${u.execution}${u.execution_reason ? ` (${u.execution_reason})` : ""}; review tier ${u.review}`,
    `- Estimate: ${e?.o} / ${e?.m} / ${e?.p} days (optimistic, likely, pessimistic)`,
    u.acceptance_by_people ? `- Acceptance needs people: ${u.acceptance_by_people.what}` : "",
    u.note ? `- Note: ${u.note}` : "",
    "",
    "Mirrored from docs/plan/units.yaml at the plan freeze. If this issue and the record disagree, the record wins.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

type Field = { id: string; name: string; options?: { id: string; name: string }[] };
const units = (await loadUnits()).filter((u) => u.phase !== "P4");
const existing = new Set(
  (JSON.parse(gh(["issue", "list", "--repo", REPO, "--state", "all", "--limit", "1000", "--json", "title"])) as { title: string }[]).map(
    (i) => i.title.split(" ")[0],
  ),
);
const todo = units.filter((u) => !existing.has(u.id));
console.error(`${units.length} units; ${units.length - todo.length} already have issues; ${todo.length} to create`);

const projectId = gh(["project", "view", String(BOARD), "--owner", OWNER, "--format", "json", "-q", ".id"]);
const fields = (JSON.parse(gh(["project", "field-list", String(BOARD), "--owner", OWNER, "--format", "json"])) as { fields: Field[] }).fields;
const field = (name: string): Field => {
  const f = fields.find((x) => x.name === name);
  if (!f) throw new Error(`board ${BOARD} has no field "${name}"`);
  return f;
};
const option = (name: string, value: string): string => {
  const o = field(name).options?.find((x) => x.name === value);
  if (!o) throw new Error(`field "${name}" has no option "${value}"`);
  return o.id;
};
const EXECUTION = { "human-only": "Human-only", "human-led": "Human-led", "agent-fan-out": "Agent fan-out" } as const;
const STATUS = (s: string) => (s === "done" ? "Done" : s === "todo" ? "Todo" : "In Progress");

/** The board values for a unit, as gh item-edit flags. */
function values(u: Unit): { name: string; flag: string; value: string }[] {
  const e = u.estimate_days;
  const v: { name: string; flag: string; value: string }[] = [
    { name: "Status", flag: "--single-select-option-id", value: option("Status", STATUS(u.status)) },
    { name: "Unit ID", flag: "--text", value: u.id },
    { name: "Section", flag: "--single-select-option-id", value: option("Section", u.section) },
    { name: "Complexity", flag: "--single-select-option-id", value: option("Complexity", String(u.complexity)) },
    { name: "Uncertainty", flag: "--single-select-option-id", value: option("Uncertainty", String(u.uncertainty)) },
    { name: "Spike", flag: "--single-select-option-id", value: option("Spike", u.spike ? "Yes" : "No") },
    { name: "Execution", flag: "--single-select-option-id", value: option("Execution", EXECUTION[u.execution ?? "agent-fan-out"]) },
    { name: "Review tier", flag: "--single-select-option-id", value: option("Review tier", u.review === "critical" ? "Critical" : "Standard") },
  ];
  if (u.depends_on.length) v.push({ name: "Depends on", flag: "--text", value: u.depends_on.join(", ") });
  if (e?.o != null) v.push({ name: "Estimate optimistic (days)", flag: "--number", value: String(e.o) });
  if (e?.m != null) v.push({ name: "Estimate likely (days)", flag: "--number", value: String(e.m) });
  if (e?.p != null) v.push({ name: "Estimate pessimistic (days)", flag: "--number", value: String(e.p) });
  return v;
}

for (const u of todo) {
  const title = `${u.id} ${u.title}`;
  const fv = values(u);
  if (!run) {
    console.log(`would create "${title}" and set ${fv.map((x) => x.name).join(", ")}`);
    continue;
  }
  const url = gh(["issue", "create", "--repo", REPO, "--title", title, "--body", body(u)]);
  const itemId = gh(["project", "item-add", String(BOARD), "--owner", OWNER, "--url", url, "--format", "json", "-q", ".id"]);
  for (const x of fv) gh(["project", "item-edit", "--id", itemId, "--project-id", projectId, "--field-id", field(x.name).id, x.flag, x.value]);
  console.log(`${u.id} ${url}`);
  await Bun.sleep(PAUSE_MS);
}
if (!run) console.error("Dry run. Create them with: bun scripts/plan/issues.ts --run");
