import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { dayNumber, parseAreas, pickArea } from "./area.ts";

const readme = `# Page maps

| Tree | Routes | Map |
| --- | --- | --- |
| Guest area | \`/\`, \`/help\` | [\`(guest)/README.md\`](<(guest)/README.md>) |
| Checkout | \`/checkout/[holdId]\` | [\`(checkout)/checkout/README.md\`](<(checkout)/checkout/README.md>) |
| Ops area | \`/ops/*\` | [\`(ops)/README.md\`](<(ops)/README.md>) |
| Sign-in and account | \`/sign-in\` | [\`(guest)/sign-in/README.md\`](<(guest)/sign-in/README.md>) |

Rendered views of the same maps: https://example.test/maps/
`;
const areas = parseAreas(readme);
const day = (n: number) => new Date(n * 86_400_000 + 3_600_000);

test("reads one area per table row, with its page map", () => {
  expect(areas.map((a) => a.slug)).toEqual(["guest-area", "checkout", "ops-area", "sign-in-and-account"]);
  expect(areas[1]).toEqual({
    slug: "checkout",
    name: "Checkout",
    routes: "`/checkout/[holdId]`",
    readme: "src/app/(checkout)/checkout/README.md",
    dir: "src/app/(checkout)/checkout",
  });
});

test("the real table yields every tree with a page map that exists", () => {
  const real = parseAreas(readFileSync("src/app/README.md", "utf8"));
  expect(real.length).toBeGreaterThanOrEqual(8);
  for (const area of real) expect(() => readFileSync(area.readme, "utf8")).not.toThrow();
});

test("rotates by day number and wraps, with no stored state", () => {
  const start = dayNumber(day(20_000));
  expect(Array.from({ length: 5 }, (_, i) => pickArea(areas, day(start + i)).slug)).toEqual(
    Array.from({ length: 5 }, (_, i) => areas[(start + i) % 4].slug),
  );
  expect(pickArea(areas, day(start)).slug).toBe(pickArea(areas, day(start + 4)).slug);
});

test("a whole UTC day maps to one number", () => {
  expect(dayNumber(new Date("2026-11-21T00:00:00Z"))).toBe(dayNumber(new Date("2026-11-21T23:59:59Z")));
  expect(dayNumber(new Date("2026-11-22T00:00:00Z"))).toBe(dayNumber(new Date("2026-11-21T00:00:00Z")) + 1);
});

test.each([
  ["checkout", "checkout"],
  ["ops", "ops-area"],
  ["Ops area", "ops-area"],
  ["sign-in", "sign-in-and-account"],
])("an override of %s picks %s", (override, slug) => {
  expect(pickArea(areas, day(1), override).slug).toBe(slug);
});

test.each([
  ["nowhere", "matches nothing"],
  ["guest-area-x", "matches nothing"],
])("an override of %s is refused and lists the areas", (override, why) => {
  expect(() => pickArea(areas, day(1), override)).toThrow(new RegExp(`${why}; areas: guest-area, checkout`));
});

test("a prefix shared by two areas is ambiguous unless one is exact", () => {
  const twins = parseAreas(`${readme}| Host area | \`/host\` | [\`(host)/README.md\`](<(host)/README.md>) |\n| Host tools | \`/h\` | [\`(host)/tools/README.md\`](<(host)/tools/README.md>) |\n`);
  expect(() => pickArea(twins, day(1), "host")).toThrow("is ambiguous");
  expect(pickArea(twins, day(1), "host-area").slug).toBe("host-area");
});

test("no areas is an error, not a silent skip", () => {
  expect(() => pickArea([], day(1))).toThrow("no areas found");
});
