// The `human-read` check (ADR 0010, single lane). A critical-tier PR passes only once the owner has approved its current
// head; agents act as the App, so they cannot approve as the owner and cannot pass this check for themselves.
// Standard-tier and bookkeeping PRs pass at once. Env: PR_NUMBER, PR_TITLE, HEAD_SHA, GH_TOKEN, GITHUB_REPOSITORY.
import { readFileSync } from "node:fs";
import { REVIEWER } from "./agent-git.ts";
import { parseUnits, readTitle, type Tier, type Verdict } from "./scope-check.ts";

/** A pull request review, reduced to the fields the check reads. Reviews arrive oldest first. */
export interface Review {
  user: string;
  state: string;
  commit_id: string;
}

/** Comments leave a standing approval or request for changes in force, so only these states replace one. */
const DECIDING = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);

export function checkHumanRead(input: { title: string; units: Map<string, Tier>; reviews: Review[]; headSha: string }): Verdict {
  const { bookkeeping, unitId } = readTitle(input.title);
  if (bookkeeping) return { ok: true, reason: "PM bookkeeping: no code to read." };
  const tier = unitId ? input.units.get(unitId) : undefined;
  if (!tier) return { ok: false, reason: `No unit from units.yaml in the title, so the tier is unknown: ${input.title}` };
  if (tier === "standard") return { ok: true, reason: `${unitId} is standard tier: the agent checks are enough.` };
  const latest = input.reviews.filter((r) => r.user === REVIEWER && DECIDING.has(r.state)).at(-1);
  if (latest?.state === "APPROVED" && latest.commit_id === input.headSha) {
    return { ok: true, reason: `${unitId} is critical tier and ${REVIEWER} approved ${input.headSha.slice(0, 7)}.` };
  }
  const why = latest?.state === "APPROVED" ? "approved an earlier commit" : latest ? latest.state.toLowerCase().replace("_", " ") : "has not reviewed it";
  return { ok: false, reason: `${unitId} is critical tier: waiting for ${REVIEWER} to approve this head (${REVIEWER} ${why}).` };
}

if (import.meta.main) {
  try {
    const { PR_NUMBER = "", PR_TITLE = "", HEAD_SHA = "", GITHUB_REPOSITORY = "" } = process.env;
    if (!PR_NUMBER || !HEAD_SHA || !GITHUB_REPOSITORY) throw new Error("PR_NUMBER, HEAD_SHA and GITHUB_REPOSITORY are required");
    const api = Bun.spawnSync(
      ["gh", "api", "--paginate", `repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/reviews`, "-q", ".[] | {user: .user.login, state, commit_id}"],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (api.exitCode !== 0) throw new Error(`gh api reviews failed: ${api.stderr.toString().trim()}`);
    const reviews = api.stdout.toString().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Review);
    const verdict = checkHumanRead({
      title: PR_TITLE,
      units: parseUnits(readFileSync("docs/plan/units.yaml", "utf8")),
      reviews,
      headSha: HEAD_SHA,
    });
    console.log(verdict.reason);
    process.exit(verdict.ok ? 0 : 1);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
