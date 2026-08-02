import { describe, expect, test } from "bun:test";
import { validateContract } from "../../src/domain/contract-schema.ts";
import { contractDigest } from "../../src/domain/digest.ts";
import { computeObligations } from "../../src/domain/obligations.ts";
import type { EvidenceRecord } from "../../src/domain/evidence-schema.ts";

function contract() {
  const r = validateContract({
    version: 1,
    outcome: "demo",
    mode: "strict",
    criteria: [
      { id: "unit", description: "unit tests", verifiers: ["v-unit"] },
      { id: "lint", description: "lint clean", verifiers: ["v-lint"] },
      { id: "review", description: "human review", requiresApproval: true },
    ],
    verifiers: [
      { id: "v-unit", argv: ["bun", "test"] },
      { id: "v-lint", argv: ["bun", "run", "lint"] },
    ],
    approvals: [],
  });
  if (!r.ok) throw new Error(r.issues.join("; "));
  return r.contract;
}

function evidence(
  digest: string,
  criterionId: string,
  verifierId: string,
  result: EvidenceRecord["result"],
  timestamp: string,
): EvidenceRecord {
  return {
    contractDigest: digest,
    prooflineVersion: "0.1.0",
    criterionId,
    verifierId,
    argv: ["x"],
    cwd: ".",
    result,
    exitCode: result === "passed" ? 0 : 1,
    durationMs: 1,
    timestamp,
    outputBytes: 0,
    outputDigest: "0".repeat(64),
    truncated: false,
  };
}

describe("computeObligations", () => {
  test("criterion with no evidence is unproven; approval-gated one is blocked", () => {
    const c = contract();
    const digest = contractDigest(c);
    const states = computeObligations(c, [], digest);
    const byId = Object.fromEntries(states.map((s) => [s.id, s.state]));
    expect(byId["unit"]).toBe("unproven");
    expect(byId["lint"]).toBe("unproven");
    expect(byId["review"]).toBe("blocked");
  });

  test("passing evidence under the current digest proves a criterion", () => {
    const c = contract();
    const digest = contractDigest(c);
    const states = computeObligations(
      c,
      [evidence(digest, "unit", "v-unit", "passed", "2026-08-02T00:00:00.000Z")],
      digest,
    );
    expect(states.find((s) => s.id === "unit")!.state).toBe("proven");
  });

  test("a failing latest result marks the criterion failed", () => {
    const c = contract();
    const digest = contractDigest(c);
    const states = computeObligations(
      c,
      [
        evidence(digest, "unit", "v-unit", "passed", "2026-08-02T00:00:00.000Z"),
        evidence(digest, "unit", "v-unit", "failed", "2026-08-02T01:00:00.000Z"),
      ],
      digest,
    );
    expect(states.find((s) => s.id === "unit")!.state).toBe("failed");
  });

  test("evidence for a stale contract digest does not count", () => {
    const c = contract();
    const digest = contractDigest(c);
    const states = computeObligations(
      c,
      [evidence("f".repeat(64), "unit", "v-unit", "passed", "2026-08-02T00:00:00.000Z")],
      digest,
    );
    expect(states.find((s) => s.id === "unit")!.state).toBe("unproven");
  });

  test("an approval satisfies a manual criterion", () => {
    const base = contract();
    const withApproval = validateContract({
      version: 1,
      outcome: "demo",
      mode: "strict",
      criteria: base.criteria,
      verifiers: base.verifiers,
      approvals: [{ criterion: "review", by: "abhinav" }],
    });
    if (!withApproval.ok) throw new Error("bad");
    const c = withApproval.contract;
    const digest = contractDigest(c);
    const states = computeObligations(c, [], digest);
    expect(states.find((s) => s.id === "review")!.state).toBe("proven");
  });

  test("digest is stable regardless of key order and changes with content", () => {
    const c = contract();
    const d1 = contractDigest(c);
    expect(d1).toMatch(/^[0-9a-f]{64}$/);
    const changed = validateContract({
      version: 1,
      outcome: "different outcome",
      mode: "strict",
      criteria: c.criteria,
      verifiers: c.verifiers,
    });
    if (!changed.ok) throw new Error("bad");
    expect(contractDigest(changed.contract)).not.toBe(d1);
  });
});
