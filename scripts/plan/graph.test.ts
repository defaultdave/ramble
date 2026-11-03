import { expect, test } from "bun:test";
import { dropUnits, selectScope } from "./graph.ts";
import type { Unit } from "./units.ts";

const unit = (id: string, depends_on: string[] = []): Unit => ({ id, depends_on, phase: "P5", mode: "both", priority: "Must" }) as unknown as Unit;
const record = [unit("U-1"), unit("U-2", ["U-1"]), unit("U-3", ["U-2"])];

test("a dropped unit leaves the record and its dependents stop waiting on it", () => {
  const kept = dropUnits(record, new Set(["U-2"]));
  expect(kept.map((u) => [u.id, u.depends_on])).toEqual([
    ["U-1", []],
    ["U-3", []],
  ]);
  expect(selectScope(kept, "demo", false).deps.get("U-3")).toEqual([]);
});

test("dropping nothing returns the record's units unchanged", () => {
  expect(dropUnits(record, new Set())).toEqual(record);
});

test("an id outside the record is an error", () => {
  expect(() => dropUnits(record, new Set(["U-9", "U-1"]))).toThrow("U-9");
});
