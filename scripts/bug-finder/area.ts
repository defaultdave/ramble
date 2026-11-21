// Picks the one area of the site the bug finder looks at (ADR 0012). Deterministic: the agent never chooses.
// Areas are the rows of the table in src/app/README.md, so a new route tree joins the rotation by being documented.
// Run: bun scripts/bug-finder/area.ts [area]   (prints JSON: { slug, name, routes, readme, dir })
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Area {
  slug: string;
  name: string;
  routes: string;
  /** The tree's page map, relative to the repo root. */
  readme: string;
  dir: string;
}

const APP_README = "src/app/README.md";
const DAY_MS = 86_400_000;

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** One area per row of the page-map table: `| Name | routes | [`path`](<path>) |`, the path in angle brackets because it has parentheses. */
export function parseAreas(readme: string): Area[] {
  const areas: Area[] = [];
  for (const line of readme.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    const link = cells[3]?.match(/\]\(<([^>]+README\.md)>\)/)?.[1];
    if (cells.length < 5 || !link || cells[1] === "Tree") continue;
    const readmePath = `src/app/${link}`;
    areas.push({ slug: slugify(cells[1]), name: cells[1], routes: cells[2], readme: readmePath, dir: dirname(readmePath) });
  }
  return areas;
}

/** UTC days since the epoch, so the rotation needs no stored state. */
export const dayNumber = (date: Date) => Math.floor(date.getTime() / DAY_MS);

/** An override matches a slug exactly, or its first words (`ops` for `ops-area`). */
export function pickArea(areas: Area[], date: Date, override?: string): Area {
  if (areas.length === 0) throw new Error(`no areas found in ${APP_README}`);
  const wanted = override ? slugify(override) : "";
  if (!wanted) return areas[dayNumber(date) % areas.length];
  const matches = areas.filter((area) => area.slug === wanted || area.slug.startsWith(`${wanted}-`));
  const exact = matches.find((area) => area.slug === wanted);
  if (exact ?? matches.length === 1) return exact ?? matches[0];
  throw new Error(`area "${override}" ${matches.length ? "is ambiguous" : "matches nothing"}; areas: ${areas.map((a) => a.slug).join(", ")}`);
}

if (import.meta.main) {
  try {
    const area = pickArea(parseAreas(readFileSync(APP_README, "utf8")), new Date(), process.argv[2]);
    console.log(JSON.stringify(area));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
