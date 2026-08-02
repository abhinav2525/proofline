import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { prooflinePaths } from "../../src/storage/paths.ts";
import { saveContract } from "../../src/storage/contract-store.ts";
import { appendEvidence } from "../../src/storage/evidence-store.ts";
import { validateContract } from "../../src/domain/contract-schema.ts";
import type { EvidenceRecord } from "../../src/domain/evidence-schema.ts";

let root: string;
let external: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "proofline-wc-"));
  external = await mkdtemp(path.join(tmpdir(), "proofline-wc-ext-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(external, { recursive: true, force: true });
});

function sampleContract() {
  const r = validateContract({
    version: 1,
    outcome: "containment",
    mode: "strict",
    criteria: [{ id: "c1", description: "d", verifiers: ["v1"] }],
    verifiers: [{ id: "v1", argv: ["true"] }],
  });
  if (!r.ok) throw new Error("bad sample");
  return r.contract;
}

function record(): EvidenceRecord {
  return {
    contractDigest: "a".repeat(64),
    prooflineVersion: "0.1.0",
    criterionId: "c1",
    verifierId: "v1",
    argv: ["true"],
    cwd: ".",
    result: "passed",
    exitCode: 0,
    durationMs: 1,
    timestamp: "2026-08-02T00:00:00.000Z",
    outputBytes: 0,
    outputDigest: "0".repeat(64),
    truncated: false,
  };
}

describe("write containment", () => {
  test("refuses to save a contract when .proofline is a symlink escaping the root", async () => {
    const paths = prooflinePaths(root);
    await symlink(external, paths.dir, "dir");

    await expect(saveContract(paths, sampleContract())).rejects.toThrow();

    // Nothing was written into the external directory.
    expect(existsSync(path.join(external, "delivery.yaml"))).toBe(false);
    expect(await readdir(external)).toEqual([]);
  });

  test("refuses to append evidence when .proofline escapes the root", async () => {
    const paths = prooflinePaths(root);
    await symlink(external, paths.dir, "dir");

    await expect(appendEvidence(paths, record())).rejects.toThrow();
    expect(existsSync(path.join(external, "evidence.json"))).toBe(false);
    expect(await readdir(external)).toEqual([]);
  });

  test("still writes normally when .proofline is a real in-root directory", async () => {
    const paths = prooflinePaths(root);
    await saveContract(paths, sampleContract());
    expect(existsSync(paths.contractPath)).toBe(true);
  });
});
