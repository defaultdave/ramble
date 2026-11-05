import { expect, test } from "bun:test";
import { checkHumanRead, type Review } from "./human-read.ts";
import { parseUnits } from "./scope-check.ts";

const units = parseUnits(`units:
  - id: U-001
    review: standard
  - id: U-002
    review: critical
`);
const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const owner = (state: string, commit_id = HEAD): Review => ({ user: "defaultdave", state, commit_id });
const check = (title: string, reviews: Review[] = []) => checkHumanRead({ title, units, reviews, headSha: HEAD });

test.each(["U-001: Repo and CI", "Revert: U-001: Repo and CI", "PM bookkeeping: mark U-002 done"])(
  "%s passes with no review",
  (title) => {
    expect(check(title).ok).toBe(true);
  },
);

test("a title with no known unit fails, since its tier is unknown", () => {
  expect(check("U-999: unknown").ok).toBe(false);
});

test.each([
  ["no review", []],
  ["an approval of an earlier commit", [owner("APPROVED", OLD)]],
  ["a request for changes after the approval", [owner("APPROVED"), owner("CHANGES_REQUESTED")]],
  ["a dismissed approval", [owner("APPROVED"), owner("DISMISSED")]],
  ["an approval from someone else", [{ user: "ramble-merge-desk[bot]", state: "APPROVED", commit_id: HEAD }]],
])("a critical unit fails with %s", (_, reviews: Review[]) => {
  expect(check("U-002: skeleton", reviews).ok).toBe(false);
});

test.each([
  ["an approval of the head", [owner("APPROVED")]],
  ["an approval that a later comment does not replace", [owner("APPROVED"), owner("COMMENTED")]],
  ["an approval after a request for changes", [owner("CHANGES_REQUESTED", OLD), owner("APPROVED")]],
])("a critical unit passes with %s", (_, reviews: Review[]) => {
  expect(check("U-002: skeleton", reviews).ok).toBe(true);
});

test("a critical revert waits for the owner too", () => {
  expect(check("Revert: U-002: skeleton").ok).toBe(false);
});
