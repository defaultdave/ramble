import { expect, test } from "bun:test";
import { statusProblems } from "./roadmap-status.ts";

const complete = () => ({
  decisionsNeeded: [{ title: "Tax rate", impact: "None on dates", detail: "U-018 seeds it", recommendation: "keep it", blocks: "Nothing" }],
  actionsForDave: [{ title: "Neon console", detail: "", where: "Any time" }],
  heldUp: [{ what: "Legal review", waitingOn: "Client facts", owner: "Client" }],
  decisionsMade: [{ when: "Oct 29", what: "Lanes" }],
  watch: [{ what: "Monday", detail: "A stretch" }],
  standups: [{ date: "2026-10-29", done: ["PR 246 merged"], today: ["U-015 review"], heldUs: [{ what: "Weekly limit", cost: "Lanes paused" }] }],
});

test("a complete digest has no problems", () => {
  expect(statusProblems(complete())).toEqual([]);
});

test("standups may be absent", () => {
  const { standups: _, ...rest } = complete();
  expect(statusProblems(rest)).toEqual([]);
});

test("decisions written as what and effect name every field the cards would leave blank", () => {
  const status = { ...complete(), decisionsNeeded: [{ what: "Tax rate", effect: "None on dates" }] };
  expect(statusProblems(status)).toEqual([
    "decisionsNeeded[0].title",
    "decisionsNeeded[0].impact",
    "decisionsNeeded[0].detail",
    "decisionsNeeded[0].recommendation",
    "decisionsNeeded[0].blocks",
  ]);
});

test("a to-do written as what and when is refused", () => {
  const status = { ...complete(), actionsForDave: [{ what: "Neon console", when: "Any time" }] };
  expect(statusProblems(status)).toEqual(["actionsForDave[0].title", "actionsForDave[0].detail", "actionsForDave[0].where"]);
});

test("a missing list is named", () => {
  const { watch: _, ...rest } = complete();
  expect(statusProblems(rest)).toEqual(["watch is not a list"]);
});

test("a standup needs an ISO date, text lists, and a cost for each hold-up", () => {
  const status = { ...complete(), standups: [{ date: "Oct 29", done: [3], today: ["U-015"], heldUs: [{ what: "Weekly limit" }] }] };
  expect(statusProblems(status)).toEqual(["standups[0].date", "standups[0].done", "standups[0].heldUs[0].cost"]);
});
