import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cleanup, makeProject, runCli } from "./helpers.ts";

/**
 * The dogfooding scenario: a criterion is proven by a passing verifier AND
 * requires a human approval. `verify` passes but `status` stays `blocked`;
 * `approve` then flips it to `ready` WITHOUT rerunning the verifier — the
 * verifier evidence must survive untouched because the digest excludes approvals.
 */
const CONTRACT = `version: 1
outcome: Ship the feature
mode: strict
criteria:
  - id: feature
    description: the feature works
    verifiers:
      - v-ok
    requiresApproval: true
verifiers:
  - id: v-ok
    argv:
      - "true"
`;

const roots: string[] = [];
async function project(): Promise<string> {
  const root = await makeProject(CONTRACT);
  roots.push(root);
  return root;
}
afterEach(async () => {
  while (roots.length) await cleanup(roots.pop()!);
});

async function readEvidence(root: string): Promise<string> {
  return readFile(path.join(root, ".proofline", "evidence.json"), "utf8");
}

describe("approve end-to-end", () => {
  test("verify passes, status blocked, approve makes it ready with no rerun", async () => {
    const root = await project();

    // verify — the verifier passes, so verify exits 0 and records evidence.
    const verify = await runCli(["verify", "--json"], { cwd: root });
    expect(verify.code).toBe(0);
    expect(JSON.parse(verify.stdout).evidenceRecorded).toBe(1);
    const evidenceAfterVerify = await readEvidence(root);

    // status — the passing verifier is not enough: the criterion is blocked on
    // approval, so strict status exits 1.
    const blocked = await runCli(["status", "--json"], { cwd: root });
    expect(blocked.code).toBe(1);
    const blockedJson = JSON.parse(blocked.stdout);
    expect(blockedJson.ready).toBe(false);
    expect(blockedJson.criteria[0].state).toBe("blocked");
    const digestBefore = blockedJson.contractDigest;

    // approve — no verifier is run by this command.
    const approve = await runCli(["approve", "feature", "--by", "Alice"], { cwd: root });
    expect(approve.code).toBe(0);

    // The verifier evidence is byte-for-byte unchanged: nothing was re-run.
    expect(await readEvidence(root)).toBe(evidenceAfterVerify);

    // status — now ready, exit 0, on the SAME digest the evidence was recorded
    // under (approvals do not shift the verification digest).
    const ready = await runCli(["status", "--json"], { cwd: root });
    expect(ready.code).toBe(0);
    const readyJson = JSON.parse(ready.stdout);
    expect(readyJson.ready).toBe(true);
    expect(readyJson.criteria[0].state).toBe("proven");
    expect(readyJson.contractDigest).toBe(digestBefore);
  });
});
