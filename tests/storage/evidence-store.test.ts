import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prooflinePaths } from "../../src/storage/paths.ts";
import { appendEvidence, loadEvidence } from "../../src/storage/evidence-store.ts";
import type { EvidenceRecord } from "../../src/domain/evidence-schema.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "proofline-ev-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function record(id: string): EvidenceRecord {
  return {
    contractDigest: "a".repeat(64),
    prooflineVersion: "0.1.0",
    criterionId: id,
    verifierId: "v",
    argv: ["true"],
    cwd: ".",
    result: "passed",
    exitCode: 0,
    durationMs: 5,
    timestamp: "2026-08-02T00:00:00.000Z",
    outputBytes: 0,
    outputDigest: "0".repeat(64),
    outputPreview: "",
    truncated: false,
  };
}

describe("evidence-store", () => {
  test("missing evidence loads as an empty log", async () => {
    const result = await loadEvidence(prooflinePaths(root));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.log.records).toEqual([]);
  });

  test("append persists records across loads and preserves order", async () => {
    const paths = prooflinePaths(root);
    await appendEvidence(paths, record("first"));
    await appendEvidence(paths, record("second"));
    const result = await loadEvidence(paths);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.log.records.map((r) => r.criterionId)).toEqual(["first", "second"]);
  });

  test("corrupt evidence JSON is reported, not silently reset", async () => {
    const paths = prooflinePaths(root);
    await mkdir(paths.dir, { recursive: true });
    await writeFile(paths.evidencePath, "{ not json");
    const result = await loadEvidence(paths);
    expect(result.ok).toBe(false);
  });
});
