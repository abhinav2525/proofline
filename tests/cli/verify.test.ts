import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cleanup, makeProject, runCli } from "./helpers.ts";

const VERIFY_CONTRACT = `version: 1
outcome: demo verify
mode: strict
criteria:
  - id: ok
    description: this one passes
    verifiers:
      - v-ok
  - id: bad
    description: this one fails
    verifiers:
      - v-bad
verifiers:
  - id: v-ok
    argv:
      - bun
      - -e
      - "process.exit(0)"
  - id: v-bad
    argv:
      - bun
      - -e
      - "process.exit(1)"
`;

const roots: string[] = [];
async function project(): Promise<string> {
  const root = await makeProject(VERIFY_CONTRACT);
  roots.push(root);
  return root;
}
afterEach(async () => {
  while (roots.length) await cleanup(roots.pop()!);
});

async function readEvidence(root: string): Promise<{ records: unknown[] }> {
  const text = await readFile(path.join(root, ".proofline", "evidence.json"), "utf8");
  return JSON.parse(text);
}

describe("verify", () => {
  test("runs all verifiers, records evidence, and exits 5 when one fails", async () => {
    const root = await project();
    const r = await runCli(["verify", "--json"], { cwd: root });
    expect(r.code).toBe(5);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.evidenceRecorded).toBe(2);
    const results = parsed.ran.map((x: { verifierId: string; result: string }) => [
      x.verifierId,
      x.result,
    ]);
    expect(results).toContainEqual(["v-ok", "passed"]);
    expect(results).toContainEqual(["v-bad", "failed"]);

    const evidence = await readEvidence(root);
    expect(evidence.records.length).toBe(2);
  });

  test("--criterion limits execution to one criterion and can pass cleanly", async () => {
    const root = await project();
    const r = await runCli(["verify", "--criterion", "ok", "--json"], { cwd: root });
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ran.map((x: { verifierId: string }) => x.verifierId)).toEqual(["v-ok"]);
  });

  test("evidence records carry no environment and only bounded output", async () => {
    const root = await project();
    await runCli(["verify", "--criterion", "ok"], { cwd: root });
    const evidence = await readEvidence(root);
    const rec = (evidence.records as Array<Record<string, unknown>>)[0]!;
    expect(rec.criterionId).toBe("ok");
    expect(rec).not.toHaveProperty("env");
    expect(rec).toHaveProperty("outputDigest");
    expect(rec).toHaveProperty("contractDigest");
  });

  test("status turns proven after a passing verify, and running verify does not finalize", async () => {
    const root = await project();
    await runCli(["verify", "--criterion", "ok"], { cwd: root });
    const s = await runCli(["status", "--json"], { cwd: root });
    const parsed = JSON.parse(s.stdout);
    const ok = parsed.criteria.find((c: { id: string }) => c.id === "ok");
    const bad = parsed.criteria.find((c: { id: string }) => c.id === "bad");
    expect(ok.state).toBe("proven");
    expect(bad.state).toBe("unproven");
    // Not all proven -> not ready. A passing verify never finalizes delivery.
    expect(parsed.ready).toBe(false);
  });

  test("unknown --criterion is a usage error", async () => {
    const root = await project();
    const r = await runCli(["verify", "--criterion", "ghost"], { cwd: root });
    expect(r.code).toBe(2);
  });
});
