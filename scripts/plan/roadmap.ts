#!/usr/bin/env bun
// The executive roadmap page: docs/plan/roadmap/template.html with schedule.json and status.json inlined.
//
// Run: bun scripts/plan/forecast.ts --report schedule --out docs/plan/roadmap/schedule.json
//      bun scripts/plan/roadmap.ts
// status.json is the PM's digest of STATUS.md and DECISIONS.md, updated by hand each session.

const dir = new URL("../../docs/plan/roadmap/", import.meta.url);
const read = (name: string) => Bun.file(new URL(name, dir)).text();
/** JSON safe inside a <script> element. */
const inline = (json: string) => JSON.stringify(JSON.parse(json)).replace(/</g, "\\u003c");

const template = await read("template.html");
if (!template.includes("__SCHEDULE__") || !template.includes("__STATUS__"))
  throw new Error("template.html needs the __SCHEDULE__ and __STATUS__ placeholders");
const page = template.replace("__SCHEDULE__", inline(await read("schedule.json"))).replace("__STATUS__", inline(await read("status.json")));
await Bun.write(new URL("index.html", dir), page);
console.error("wrote docs/plan/roadmap/index.html");
