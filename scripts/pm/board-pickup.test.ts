import { expect, test } from "bun:test";
import { type BoardItem, itemToStart, unitFromCommand } from "./board-pickup.ts";

test.each([
  ["git worktree add -b unit/U-047b-maint-P05 ../wt origin/main", "U-047b"],
  ["cd /Users/x/ramble && git worktree add ../wt -b unit/U-030-browse origin/main", "U-030"],
  ["git -C /Users/x/ramble worktree add ../wt unit/U-012", "U-012"],
])("unitFromCommand reads the unit from %s", (command, unit) => {
  expect(unitFromCommand(command)).toBe(unit);
});

test.each([
  ["a worktree for a non-unit branch", "git worktree add ../wt -b claude/audit origin/main"],
  ["a unit branch that is only pushed", "bun scripts/merge-desk/agent-git.ts push unit/U-030-browse"],
  ["removing a unit worktree", "git worktree remove ../wt && git branch -D unit/U-030-browse"],
  ["a worktree add after a separator, for another branch", "git branch unit/U-030 ; git worktree add ../wt main"],
])("unitFromCommand ignores %s", (_, command) => {
  expect(unitFromCommand(command)).toBeNull();
});

const items: BoardItem[] = [
  { id: "A", "unit ID": "U-030", status: "Todo" },
  { id: "B", "unit ID": "U-031", status: "In Progress" },
  { id: "C", "unit ID": "U-032", status: "Done" },
];

test("itemToStart moves a unit still in Todo", () => {
  expect(itemToStart(items, "U-030")?.id).toBe("A");
});

test.each(["U-031", "U-032", "U-999"])("itemToStart leaves %s alone", (unit) => {
  expect(itemToStart(items, unit)).toBeNull();
});
