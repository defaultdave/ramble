import { expect, test } from "bun:test";
import { buildCheckRun, postCheck, SUMMARY_LIMIT } from "./post-check.ts";

const sha = "a".repeat(40);
const input = { name: "review-agent", sha, conclusion: "success", summary: "looks fine" };

test("builds a completed check run with the title and summary", () => {
  expect(buildCheckRun(input)).toEqual({
    name: "review-agent",
    head_sha: sha,
    status: "completed",
    conclusion: "success",
    output: { title: "review-agent: success", summary: "looks fine" },
  });
});

test("cuts the summary to 65,000 characters", () => {
  const run = buildCheckRun({ ...input, summary: "x".repeat(SUMMARY_LIMIT + 500) });
  expect(run.output.summary.length).toBe(SUMMARY_LIMIT);
});

test("rejects a check name that is not one of the three agent checks", () => {
  expect(() => buildCheckRun({ ...input, name: "scope-manifest" })).toThrow("--name");
});

test("rejects a conclusion other than success or failure", () => {
  expect(() => buildCheckRun({ ...input, conclusion: "neutral" })).toThrow("--conclusion");
});

test("rejects a short sha", () => {
  expect(() => buildCheckRun({ ...input, sha: "abc123" })).toThrow("--sha");
});

test("postCheck posts to the repo's check-runs endpoint with the token", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response("{}", { status: 201 });
  }) as unknown as typeof fetch;
  await postCheck(input, "ghs_fake", fakeFetch);
  expect(seen[0].url).toBe("https://api.github.com/repos/defaultdave/ramble/check-runs");
  expect((seen[0].init.headers as Record<string, string>).Authorization).toBe("Bearer ghs_fake");
  expect(JSON.parse(String(seen[0].init.body)).name).toBe("review-agent");
});

test("postCheck fails with the status when GitHub refuses", async () => {
  const fakeFetch = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
  await expect(postCheck(input, "ghs_fake", fakeFetch)).rejects.toThrow("HTTP 403");
});
