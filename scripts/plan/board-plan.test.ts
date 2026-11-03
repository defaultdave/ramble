import { expect, test } from "bun:test";
import { isOutOfPlan, planLists } from "./board-plan.ts";

test("Parked and Cut items are out of the plan, the rest are in", () => {
  expect(["Parked", "Cut", "Sprint 2", "Sprint 3", "Test bed", undefined].map((plan) => isOutOfPlan({ plan }))).toEqual([
    true,
    true,
    false,
    false,
    false,
    false,
  ]);
});

test("planLists drops Parked and Cut units and lists Done units, ignoring items without a unit ID", () => {
  expect(
    planLists([
      { "unit ID": "U-001", status: "Done" },
      { "unit ID": "U-002", status: "Todo", plan: "Parked" },
      { "unit ID": "U-003", status: "In Progress", plan: "Cut" },
      { "unit ID": "U-004", status: "Todo", plan: "Sprint 2" },
      { status: "Done", plan: "Cut" },
    ]),
  ).toEqual({ drop: ["U-002", "U-003"], done: ["U-001"] });
});

test("a unit that is Done and out of the plan is only dropped", () => {
  expect(planLists([{ "unit ID": "U-005", status: "Done", plan: "Cut" }])).toEqual({ drop: ["U-005"], done: [] });
});
