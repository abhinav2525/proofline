import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cleanup, makeProject, runCli, VALID_CONTRACT } from "./helpers.ts";
import { buildContractFromAnswers } from "../../src/commands/brief.ts";

const roots: string[] = [];
async function project(contract?: string): Promise<string> {
  const root = await makeProject(contract);
  roots.push(root);
  return root;
}
afterEach(async () => {
  while (roots.length) await cleanup(roots.pop()!);
});

const answers = {
  outcome: "Export widgets to CSV",
  mode: "strict",
  constraints: ["stay offline"],
  criteria: [{ id: "unit", description: "unit tests pass", verifiers: ["v-unit"] }],
  verifiers: [{ id: "v-unit", argv: ["bun", "test"] }],
};

describe("buildContractFromAnswers", () => {
  test("builds a valid contract and injects version", () => {
    const r = buildContractFromAnswers(answers);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.contract.version).toBe(1);
    expect(r.contract.outcome).toBe("Export widgets to CSV");
  });

  test("rejects a non-object answers payload", () => {
    expect(buildContractFromAnswers([]).ok).toBe(false);
    expect(buildContractFromAnswers("nope").ok).toBe(false);
  });
});

describe("brief (non-interactive stdin)", () => {
  test("writes a valid contract from piped answers", async () => {
    const root = await project();
    const r = await runCli(["brief", "--json"], {
      cwd: root,
      stdin: JSON.stringify(answers),
    });
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(true);

    // The written contract validates through the real load path.
    const v = await runCli(["validate", "--json"], { cwd: root });
    expect(v.code).toBe(0);
  });

  test("refuses to overwrite an existing contract without --force", async () => {
    const root = await project(VALID_CONTRACT);
    const before = await readFile(path.join(root, ".proofline", "delivery.yaml"), "utf8");
    const r = await runCli(["brief"], { cwd: root, stdin: JSON.stringify(answers) });
    expect(r.code).toBe(2);
    const after = await readFile(path.join(root, ".proofline", "delivery.yaml"), "utf8");
    expect(after).toBe(before);
  });

  test("overwrites with --force", async () => {
    const root = await project(VALID_CONTRACT);
    const r = await runCli(["brief", "--force", "--json"], {
      cwd: root,
      stdin: JSON.stringify(answers),
    });
    expect(r.code).toBe(0);
    const after = await readFile(path.join(root, ".proofline", "delivery.yaml"), "utf8");
    expect(after).toContain("Export widgets to CSV");
  });

  test("aborts on empty input without writing a contract", async () => {
    const root = await project();
    const r = await runCli(["brief"], { cwd: root, stdin: "" });
    expect(r.code).not.toBe(0);
    const v = await runCli(["validate", "--json"], { cwd: root });
    expect(v.code).toBe(3); // still no contract
  });

  test("reports validation issues for bad answers (exit 4)", async () => {
    const root = await project();
    const r = await runCli(["brief"], {
      cwd: root,
      stdin: JSON.stringify({ ...answers, mode: "banana" }),
    });
    expect(r.code).toBe(4);
    expect(r.stderr.length).toBeGreaterThan(0);
  });
});
