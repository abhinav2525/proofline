import { afterEach, describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { cleanup, makeProject, runCli, VALID_CONTRACT } from "./helpers.ts";

const roots: string[] = [];
async function project(contract?: string): Promise<string> {
  const root = await makeProject(contract);
  roots.push(root);
  return root;
}
afterEach(async () => {
  while (roots.length) await cleanup(roots.pop()!);
});

describe("init", () => {
  test("creates .proofline in a fresh project", async () => {
    const root = await project();
    const r = await runCli(["init", "--json"], { cwd: root });
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.created).toBe(true);
    expect(parsed.contractExists).toBe(false);
    const s = await stat(path.join(root, ".proofline"));
    expect(s.isDirectory()).toBe(true);
  });

  test("is idempotent when the directory already exists", async () => {
    const root = await project();
    await runCli(["init"], { cwd: root });
    const r = await runCli(["init", "--json"], { cwd: root });
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.created).toBe(false);
  });

  test("never overwrites an existing contract", async () => {
    const root = await project(VALID_CONTRACT);
    const before = await readFile(path.join(root, ".proofline", "delivery.yaml"), "utf8");
    const r = await runCli(["init", "--json"], { cwd: root });
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.contractExists).toBe(true);
    const after = await readFile(path.join(root, ".proofline", "delivery.yaml"), "utf8");
    expect(after).toBe(before);
  });
});
