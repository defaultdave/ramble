#!/usr/bin/env bun
// Puts the forecast's dates on the "Ramble" project board, so GitHub's roadmap view can draw the plan: each unit's
// likely (P50) start and finish under the plan of record, and the sprint it finishes in. Read from
// roadmap/schedule.json in the ramble-pm repo (bun scripts/plan/forecast.ts --report schedule ...), the same data as the
// roadmap page.
//
// Run: bun scripts/plan/board-dates.ts          print what it would set
//      bun scripts/plan/board-dates.ts --run    create the fields if missing, then set every scheduled unit's values
// A unit already started (board Status other than Todo) keeps the real Start date set on the board.
// Units the schedule leaves out (the Shoulds, the real-job adapter, the post-launch tail) keep empty dates.

import { flag, option, siteDir } from "./units";

const OWNER = "defaultdave";
const BOARD = 19;
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

type Sprint = { sprint: number; startDay: number; endDay: number; startDate: string; endDate: string };
type Planned = { id: string; start: number; end: number; startDate: string; endDate: string };
type Schedule = { sprints: Sprint[]; scenarios: { name: string; units: Planned[] }[] };
type Field = { id: string; name: string; type: string; options?: { id: string; name: string }[] };

const schedule: Schedule = await Bun.file(`${siteDir()}/roadmap/schedule.json`).json();
const scenarioName = option("scenario", schedule.scenarios[0].name);
const scenario = schedule.scenarios.find((s) => s.name === scenarioName);
if (!scenario) throw new Error(`schedule.json has no scenario "${scenarioName}"`);
const lastEnd = Math.max(...scenario.units.map((u) => u.end));
const sprints = schedule.sprints.filter((s) => s.startDay <= lastEnd);
const sprintLabel = (s: Sprint) => {
  const d = new Date(`${s.startDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `S${s.sprint} · ${d}`;
};
const sprintOf = (u: Planned) => sprints.find((s) => u.end >= s.startDay && u.end < s.endDay) ?? sprints[sprints.length - 1];

const projectId = gh(["project", "view", String(BOARD), "--owner", OWNER, "--format", "json", "-q", ".id"]);
const listFields = (): Field[] =>
  (JSON.parse(gh(["project", "field-list", String(BOARD), "--owner", OWNER, "--format", "json"])) as { fields: Field[] }).fields;
let fields = listFields();
const wanted = [
  { name: "Start date", type: "DATE" },
  { name: "Target date", type: "DATE" },
  { name: "Sprint", type: "SINGLE_SELECT", options: sprints.map(sprintLabel) },
];
for (const w of wanted) {
  const have = fields.find((f) => f.name === w.name);
  // A refit moves the sprint calendar; the Sprint field is rebuilt with the new labels, since every unit's value is reset below.
  const stale = have && w.options && (have.options ?? []).map((o) => o.name).join("|") !== w.options.join("|");
  if (have && !stale) continue;
  if (have && stale && !run) console.log(`would rebuild field "${w.name}" with new options`);
  if (have && stale && run) gh(["project", "field-delete", "--id", have.id]);
  if (!run) {
    console.log(`would create field "${w.name}" (${w.type}${w.options ? `: ${w.options.join(", ")}` : ""})`);
    continue;
  }
  gh([
    "project",
    "field-create",
    String(BOARD),
    "--owner",
    OWNER,
    "--name",
    w.name,
    "--data-type",
    w.type,
    ...(w.options ? ["--single-select-options", w.options.join(",")] : []),
  ]);
}
if (run) fields = listFields();
const field = (name: string) => fields.find((f) => f.name === name);

// Board items carry the unit ID in the "Unit ID" field, which gh's JSON names "unit ID".
type Item = { id: string; "unit ID"?: string; status?: string };
const items = (
  JSON.parse(gh(["project", "item-list", String(BOARD), "--owner", OWNER, "--limit", "500", "--format", "json"])) as {
    items: Item[];
  }
).items;
const itemOf = new Map(items.filter((i) => i["unit ID"]).map((i) => [i["unit ID"] as string, i]));
const missing = scenario.units.filter((u) => !itemOf.has(u.id)).map((u) => u.id);
if (missing.length) console.error(`no board item for ${missing.join(", ")}`);

let set = 0;
for (const u of scenario.units) {
  const item = itemOf.get(u.id);
  if (!item) continue;
  const sp = sprintLabel(sprintOf(u));
  if (!run) {
    console.log(`${u.id}: ${u.startDate} to ${u.endDate}, ${sp}`);
    continue;
  }
  const edit = (name: string, flagName: string, value: string) => {
    const f = field(name);
    if (!f) throw new Error(`board has no field "${name}"`);
    gh(["project", "item-edit", "--id", item.id, "--project-id", projectId, "--field-id", f.id, flagName, value]);
  };
  // A unit already under way keeps its real start date on the board; the forecast only knows the planned one.
  if ((item.status ?? "Todo") === "Todo") edit("Start date", "--date", u.startDate);
  edit("Target date", "--date", u.endDate);
  const opt = field("Sprint")?.options?.find((o) => o.name === sp);
  if (!opt) throw new Error(`Sprint field has no option "${sp}"; delete the field and rerun to rebuild its options`);
  edit("Sprint", "--single-select-option-id", opt.id);
  set++;
}
console.error(
  run ? `set dates and sprint on ${set} units (${scenario.name})` : `Dry run (${scenario.name}). Apply with: bun scripts/plan/board-dates.ts --run`,
);
