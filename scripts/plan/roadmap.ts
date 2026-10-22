#!/usr/bin/env bun
// The executive roadmap page in the ramble-pm repo: roadmap/template.html with schedule.json and status.json inlined,
// written to index.html (the GitHub Pages front page), plus the status block at the top of its README.
//
// Run: bun scripts/plan/forecast.ts --report schedule --out "$(bun scripts/plan/site.ts dir)/roadmap/schedule.json"
//      bun scripts/plan/roadmap.ts
// status.json is the PM's digest of STATUS.md and DECISIONS.md, updated by hand each session.

import { siteDir, writeBlock } from "./units";

const site = siteDir();
const read = (name: string) => Bun.file(`${site}/roadmap/${name}`).text();
/** JSON safe inside a <script> element. */
const inline = (json: string) => JSON.stringify(JSON.parse(json)).replace(/</g, "\\u003c");

type Dates = { p50: string; p90: string };
type Scenario = { name: string; prototype: { dates: Dates }; finish: { dates: Dates } };
type Item = { title: string; detail?: string; recommendation?: string };
type Held = { what: string; waitingOn: string };
type Status = { asOf: string; headline: string; decisionsNeeded: Item[]; actionsForDave: Item[]; heldUp: Held[] };

const template = await read("template.html");
if (!template.includes("__SCHEDULE__") || !template.includes("__STATUS__"))
  throw new Error("template.html needs the __SCHEDULE__ and __STATUS__ placeholders");
const scheduleJson = await read("schedule.json");
const statusJson = await read("status.json");
await Bun.write(`${site}/index.html`, template.replace("__SCHEDULE__", inline(scheduleJson)).replace("__STATUS__", inline(statusJson)));

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const range = (d: Dates) => `${day(d.p50)} (late case ${day(d.p90)})`;
const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- None");
const scenario: Scenario = JSON.parse(scheduleJson).scenarios[0];
const status: Status = JSON.parse(statusJson);
await writeBlock(
  `${site}/README.md`,
  "roadmap",
  "status",
  [
    `**As of ${day(status.asOf)}.** ${status.headline}`,
    "",
    `| Milestone | Likely |`,
    `|---|---|`,
    `| Prototype | ${range(scenario.prototype.dates)} |`,
    `| Launch-ready | ${range(scenario.finish.dates)} |`,
    "",
    `Forecast: ${scenario.name}.`,
    "",
    "**Next for Dave**",
    "",
    list(status.actionsForDave.map((a) => `${a.title}. ${a.detail ?? ""}`.trim())),
    "",
    "**Decisions needed**",
    "",
    list(status.decisionsNeeded.map((d) => `${d.title}.${d.recommendation ? ` Recommended: ${d.recommendation}.` : ""}`)),
    "",
    "**Held up**",
    "",
    list(status.heldUp.map((h) => `${h.what}: ${h.waitingOn}`)),
  ].join("\n"),
);
console.error(`wrote ${site}/index.html and the README status block`);
