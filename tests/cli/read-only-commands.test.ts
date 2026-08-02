import { afterEach, describe, expect, test } from "bun:test";
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

describe("read-only commands", () => {
  test("--help exits 0 and lists commands", async () => {
    const root = await project();
    const r = await runCli(["--help"], { cwd: root });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("validate");
    expect(r.stdout).toContain("verify");
  });

  test("--version prints a version", async () => {
    const root = await project();
    const r = await runCli(["--version"], { cwd: root });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/\d+\.\d+\.\d+/);
  });

  test("unknown command is a usage error (exit 2)", async () => {
    const root = await project();
    const r = await runCli(["frobnicate"], { cwd: root });
    expect(r.code).toBe(2);
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  test("validate reports success on a valid contract", async () => {
    const root = await project(VALID_CONTRACT);
    const r = await runCli(["validate"], { cwd: root });
    expect(r.code).toBe(0);
    expect(r.stdout.toLowerCase()).toContain("valid");
  });

  test("validate --json emits pure JSON to stdout", async () => {
    const root = await project(VALID_CONTRACT);
    const r = await runCli(["validate", "--json"], { cwd: root });
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(true);
  });

  test("validate on a missing contract exits 3 with a JSON error on stdout", async () => {
    const root = await project();
    const r = await runCli(["validate", "--json"], { cwd: root });
    expect(r.code).toBe(3);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(false);
  });

  test("validate on an invalid contract exits 4 with diagnostics", async () => {
    const root = await project("version: 1\noutcome: x\nmode: nope\ncriteria: []\n");
    const r = await runCli(["validate"], { cwd: root });
    expect(r.code).toBe(4);
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  test("status reports unproven criteria and is not-ready in strict mode", async () => {
    const root = await project(VALID_CONTRACT);
    const r = await runCli(["status", "--json"], { cwd: root });
    // strict mode, nothing proven yet -> exit 1 (not ready), but valid JSON.
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ready).toBe(false);
    const unit = parsed.criteria.find((c: { id: string }) => c.id === "unit");
    expect(unit.state).toBe("unproven");
  });

  test("context lists the outcome and open work", async () => {
    const root = await project(VALID_CONTRACT);
    const r = await runCli(["context", "--json"], { cwd: root });
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.outcome).toBe("Ship the CLI");
    expect(parsed.unprovenCriteria.map((c: { id: string }) => c.id)).toContain("unit");
  });
});
