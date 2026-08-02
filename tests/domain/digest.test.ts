import { describe, expect, test } from "bun:test";
import { contractDigest } from "../../src/domain/digest.ts";
import { validateContract, type Contract } from "../../src/domain/contract-schema.ts";

/**
 * The digest is the "verification-relevant" fingerprint embedded in evidence.
 * Recording a human approval must NOT change it: an approval is a delivery
 * decision, not a change to what the verifiers prove.
 */
function contractFrom(overrides: Record<string, unknown>): Contract {
  const base = {
    version: 1,
    outcome: "Ship it",
    mode: "strict",
    constraints: ["stay offline"],
    criteria: [
      {
        id: "feature",
        description: "the feature works",
        verifiers: ["v-ok"],
        requiresApproval: true,
      },
    ],
    verifiers: [{ id: "v-ok", argv: ["true"] }],
    approvals: [],
    ...overrides,
  };
  const result = validateContract(base);
  if (!result.ok) throw new Error(`fixture invalid: ${result.issues.join("; ")}`);
  return result.contract;
}

describe("contractDigest", () => {
  test("recording an approval does not change the digest", () => {
    const before = contractFrom({ approvals: [] });
    const after = contractFrom({ approvals: [{ criterion: "feature", by: "Alice" }] });
    expect(contractDigest(after)).toBe(contractDigest(before));
  });

  test("changing a covered field (outcome) changes the digest", () => {
    expect(contractDigest(contractFrom({ outcome: "Ship v1" }))).not.toBe(
      contractDigest(contractFrom({ outcome: "Ship v2" })),
    );
  });

  test("changing verifiers changes the digest", () => {
    const a = contractFrom({ verifiers: [{ id: "v-ok", argv: ["true"] }] });
    const b = contractFrom({ verifiers: [{ id: "v-ok", argv: ["false"] }] });
    expect(contractDigest(a)).not.toBe(contractDigest(b));
  });
});
