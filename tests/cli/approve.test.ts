import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cleanup, makeProject, runCli } from "./helpers.ts";

const CONTRACT = `version: 1
outcome: Ship the feature
mode: strict
criteria:
  - id: feature
    description: the feature works
    verifiers:
      - v-ok
    requiresApproval: true
  - id: auto
    description: automated only
    verifiers:
      - v-ok
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

async function readContract(root: string): Promise<string> {
  return readFile(path.join(root, ".proofline", "delivery.yaml"), "utf8");
}

describe("proofline approve", () => {
  test("records a validated approval for a criterion that requires it", async () => {
    const root = await project();
    const run = await runCli(
      ["approve", "feature", "--by", "Alice", "--note", "reviewed the demo"],
      { cwd: root },
    );
    expect(run.code).toBe(0);

    const doc = await readContract(root);
    expect(doc).toContain("criterion: feature");
    expect(doc).toContain("by: Alice");
    expect(doc).toContain("reviewed the demo");
  });

  test("refuses an already-approved criterion instead of duplicating", async () => {
    const root = await project();
    expect((await runCli(["approve", "feature", "--by", "Alice"], { cwd: root })).code).toBe(0);

    const second = await runCli(["approve", "feature", "--by", "Bob"], { cwd: root });
    expect(second.code).toBe(2);
    expect(second.stderr.toLowerCase()).toContain("already approved");

    // The contract still holds exactly one approval for `feature`.
    const doc = await readContract(root);
    expect(doc.match(/criterion: feature/g)?.length ?? 0).toBe(1);
    expect(doc).not.toContain("by: Bob");
  });

  test("rejects a criterion that does not require approval", async () => {
    const root = await project();
    const run = await runCli(["approve", "auto", "--by", "Alice"], { cwd: root });
    expect(run.code).toBe(2);
    expect(run.stderr.toLowerCase()).toContain("does not require approval");
  });

  test("rejects an unknown criterion", async () => {
    const root = await project();
    const run = await runCli(["approve", "nope", "--by", "Alice"], { cwd: root });
    expect(run.code).toBe(2);
    expect(run.stderr.toLowerCase()).toContain("unknown criterion");
  });

  test("rejects an empty --by", async () => {
    const root = await project();
    const run = await runCli(["approve", "feature", "--by", "   "], { cwd: root });
    expect(run.code).toBe(2);
    expect(run.stderr.toLowerCase()).toContain("--by");
  });

  test("requires a --by name", async () => {
    const root = await project();
    const run = await runCli(["approve", "feature"], { cwd: root });
    expect(run.code).toBe(2);
    expect(run.stderr.toLowerCase()).toContain("--by");
  });
});
