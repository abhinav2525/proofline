import { describe, expect, test } from "bun:test";
import { validateContract } from "../../src/domain/contract-schema.ts";

const minimalValid = {
  version: 1,
  outcome: "Ship the widget export feature",
  mode: "strict",
  criteria: [
    { id: "tests-pass", description: "Unit tests pass", verifiers: ["unit"] },
  ],
  verifiers: [{ id: "unit", argv: ["bun", "test"] }],
};

describe("validateContract", () => {
  test("accepts a minimal valid contract and applies defaults", () => {
    const result = validateContract(minimalValid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contract.version).toBe(1);
    expect(result.contract.mode).toBe("strict");
    // defaults
    expect(result.contract.constraints).toEqual([]);
    expect(result.contract.approvals).toEqual([]);
    expect(result.contract.verifiers[0]!.cwd).toBe(".");
    expect(result.contract.verifiers[0]!.timeoutMs).toBeGreaterThan(0);
    expect(result.contract.criteria[0]!.requiresApproval).toBe(false);
  });

  test("rejects unknown top-level fields", () => {
    const result = validateContract({ ...minimalValid, surprise: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join("\n")).toContain("surprise");
  });

  test("rejects an invalid mode value", () => {
    const result = validateContract({ ...minimalValid, mode: "yolo" });
    expect(result.ok).toBe(false);
  });

  test("rejects duplicate verifier ids", () => {
    const result = validateContract({
      ...minimalValid,
      verifiers: [
        { id: "unit", argv: ["bun", "test"] },
        { id: "unit", argv: ["bun", "run", "lint"] },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join("\n").toLowerCase()).toContain("duplicate");
  });

  test("rejects duplicate criterion ids", () => {
    const result = validateContract({
      ...minimalValid,
      criteria: [
        { id: "dup", description: "a", verifiers: ["unit"] },
        { id: "dup", description: "b", verifiers: ["unit"] },
      ],
    });
    expect(result.ok).toBe(false);
  });

  test("rejects empty argv and empty argv entries", () => {
    expect(
      validateContract({ ...minimalValid, verifiers: [{ id: "unit", argv: [] }] }).ok,
    ).toBe(false);
    expect(
      validateContract({
        ...minimalValid,
        verifiers: [{ id: "unit", argv: ["bun", ""] }],
      }).ok,
    ).toBe(false);
  });

  test("rejects absolute or escaping verifier cwd", () => {
    expect(
      validateContract({
        ...minimalValid,
        verifiers: [{ id: "unit", argv: ["bun", "test"], cwd: "/etc" }],
      }).ok,
    ).toBe(false);
    expect(
      validateContract({
        ...minimalValid,
        verifiers: [{ id: "unit", argv: ["bun", "test"], cwd: "../outside" }],
      }).ok,
    ).toBe(false);
  });

  test("rejects a timeout above the hard cap", () => {
    expect(
      validateContract({
        ...minimalValid,
        verifiers: [{ id: "unit", argv: ["bun", "test"], timeoutMs: 999_999_999 }],
      }).ok,
    ).toBe(false);
  });

  test("rejects a criterion referencing an unknown verifier", () => {
    const result = validateContract({
      ...minimalValid,
      criteria: [{ id: "c1", description: "x", verifiers: ["nope"] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join("\n")).toContain("nope");
  });

  test("rejects an approval referencing an unknown criterion", () => {
    const result = validateContract({
      ...minimalValid,
      approvals: [{ criterion: "ghost", by: "abhinav" }],
    });
    expect(result.ok).toBe(false);
  });

  test("rejects a criterion with neither verifiers nor requiresApproval", () => {
    const result = validateContract({
      ...minimalValid,
      criteria: [{ id: "lonely", description: "x", verifiers: [] }],
    });
    expect(result.ok).toBe(false);
  });

  test("accepts a manual criterion that requires approval", () => {
    const result = validateContract({
      ...minimalValid,
      criteria: [{ id: "manual", description: "design review", requiresApproval: true }],
    });
    expect(result.ok).toBe(true);
  });
});
