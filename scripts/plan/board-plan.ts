#!/usr/bin/env bun
// Turns the board's Plan and Status fields into forecast.ts flags.
//
// Run: bun scripts/plan/board-plan.ts   prints "--drop U,..." (Parked and Cut units) and "--remaining U=0,..." (Done units
//                                       in docs/plan/units.yaml), ready to paste onto a forecast.ts command line

import { loadUnits } from "./units";

const OWNER = "defaultdave";
const BOARD = 19;
const OUT_OF_PLAN = new Set(["Parked", "Cut"]);

/** A board item as `gh project item-list` prints it; the Unit ID field is named "unit ID" there. */
export type BoardItem = { "unit ID"?: string; status?: string; plan?: string };

/** Whether the owner has taken the item out of the plan. */
export const isOutOfPlan = (item: BoardItem): boolean => OUT_OF_PLAN.has(item.plan ?? "");

/**
 * Splits board items into the units to drop from the forecast and the units already done. Items without a unit ID are ignored,
 * and a unit that is both out of the plan and Done is only dropped.
 */
export function planLists(items: BoardItem[]): { drop: string[]; done: string[] } {
  const withId = items.flatMap((i) => (i["unit ID"] ? [{ id: i["unit ID"], item: i }] : []));
  const drop = withId.filter((x) => isOutOfPlan(x.item)).map((x) => x.id);
  const done = withId.filter((x) => x.item.status === "Done" && !isOutOfPlan(x.item)).map((x) => x.id);
  return { drop: [...new Set(drop)], done: [...new Set(done)] };
}

if (import.meta.main) {
  const p = Bun.spawnSync(
    ["gh", "project", "item-list", String(BOARD), "--owner", OWNER, "--limit", "2000", "--format", "json"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (p.exitCode !== 0) throw new Error(`gh project item-list failed: ${p.stderr.toString().trim()}`);
  const { items } = JSON.parse(p.stdout.toString()) as { items: BoardItem[] };
  const inRecord = new Set((await loadUnits()).map((u) => u.id));
  const { drop, done } = planLists(items);
  console.log(`--drop ${drop.filter((id) => inRecord.has(id)).join(",")}`);
  console.log(`--remaining ${done.filter((id) => inRecord.has(id)).map((id) => `${id}=0`).join(",")}`);
}
