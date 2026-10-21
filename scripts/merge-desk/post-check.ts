// Posts one completed check run as the Ramble agents App (runbook B1).
// bun scripts/merge-desk/post-check.ts --name review-agent --sha <head sha> --conclusion success --summary-file <path>
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { mintToken } from "./app-token.ts";

export const REPO = "defaultdave/ramble";
export const CHECK_NAMES = ["review-agent", "qa-agent", "spec-compliance"] as const;
export const CONCLUSIONS = ["success", "failure"] as const;
export const SUMMARY_LIMIT = 65_000;

export interface CheckInput {
  name: string;
  sha: string;
  conclusion: string;
  summary: string;
}

/** Validates the input and builds the check-runs request body. */
export function buildCheckRun(input: CheckInput) {
  if (!(CHECK_NAMES as readonly string[]).includes(input.name)) {
    throw new Error(`--name must be one of ${CHECK_NAMES.join(", ")}`);
  }
  if (!(CONCLUSIONS as readonly string[]).includes(input.conclusion)) {
    throw new Error(`--conclusion must be one of ${CONCLUSIONS.join(", ")}`);
  }
  if (!/^[0-9a-f]{40}$/.test(input.sha)) throw new Error("--sha must be a full 40-character commit sha");
  return {
    name: input.name,
    head_sha: input.sha,
    status: "completed",
    conclusion: input.conclusion,
    output: { title: `${input.name}: ${input.conclusion}`, summary: input.summary.slice(0, SUMMARY_LIMIT) },
  };
}

export async function postCheck(input: CheckInput, token: string, doFetch: typeof fetch = fetch): Promise<void> {
  const response = await doFetch(`https://api.github.com/repos/${REPO}/check-runs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(buildCheckRun(input)),
  });
  if (!response.ok) throw new Error(`GitHub refused the check run: HTTP ${response.status}`);
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: {
        name: { type: "string" },
        sha: { type: "string" },
        conclusion: { type: "string" },
        "summary-file": { type: "string" },
      },
    });
    for (const key of ["name", "sha", "conclusion", "summary-file"] as const) {
      if (!values[key]) throw new Error(`--${key} is required`);
    }
    const input = {
      name: values.name!,
      sha: values.sha!,
      conclusion: values.conclusion!,
      summary: readFileSync(values["summary-file"]!, "utf8"),
    };
    buildCheckRun(input); // validate before minting a token
    await postCheck(input, await mintToken());
    console.log(`posted ${input.name}: ${input.conclusion} on ${input.sha.slice(0, 7)}`);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
