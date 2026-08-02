import { describe, expect, test } from "bun:test";
import { validateContract } from "../../src/domain/contract-schema.ts";
import { contractDigest } from "../../src/domain/digest.ts";
import { buildContextPack } from "../../src/domain/context-pack.ts";
import type { EvidenceRecord } from "../../src/domain/evidence-schema.ts";

function setup() {
  const r = validateContract({
    version: 1,
    outcome: "Ship the thing",
    mode: "strict",
    constraints: ["stay offline"],
    criteria: [
      { id: "unit", description: "unit tests", verifiers: ["v-unit"] },
      { id: "lint", description: "lint", verifiers: ["v-lint"] },
      { id: "review", description: "human review", requiresApproval: true },
    ],
    verifiers: [
      { id: "v-unit", argv: ["bun", "test"] },
      { id: "v-lint", argv: ["bun", "run", "lint"] },
    ],
  });
  if (!r.ok) throw new Error("bad");
  return r.contract;
}

function passed(digest: string, criterionId: string, verifierId: string): EvidenceRecord {
  return {
    contractDigest: digest,
    prooflineVersion: "0.1.0",
    criterionId,
    verifierId,
    argv: ["bun", "test"],
    cwd: ".",
    result: "passed",
    exitCode: 0,
    durationMs: 10,
    timestamp: "2026-08-02T00:00:00.000Z",
    outputBytes: 5,
    outputDigest: "0".repeat(64),
    truncated: false,
  };
}

describe("buildContextPack", () => {
  test("includes outcome/constraints, excludes proven criteria, lists open approvals", () => {
    const c = setup();
    const digest = contractDigest(c);
    const pack = buildContextPack(c, [passed(digest, "unit", "v-unit")], digest);

    expect(pack.outcome).toBe("Ship the thing");
    expect(pack.constraints).toEqual(["stay offline"]);

    const unprovenIds = pack.unprovenCriteria.map((c) => c.id);
    expect(unprovenIds).not.toContain("unit"); // proven, excluded
    expect(unprovenIds).toContain("lint");
    expect(unprovenIds).toContain("review");

    expect(pack.openApprovals.map((a) => a.criterion)).toEqual(["review"]);
  });

  test("latest evidence carries no raw output or preview", () => {
    const c = setup();
    const digest = contractDigest(c);
    const pack = buildContextPack(c, [passed(digest, "unit", "v-unit")], digest);
    expect(pack.latestEvidence.length).toBeGreaterThan(0);
    // The context summary carries only structural run metadata — no output,
    // preview, digest, or byte count.
    const serialized = JSON.stringify(pack.latestEvidence);
    expect(serialized).not.toContain("outputPreview");
    expect(serialized).not.toContain("outputDigest");
    expect(serialized).not.toContain("outputBytes");
  });
});
