import { describe, expect, test } from "bun:test";
import {
  validateEvidenceLog,
  validateEvidenceRecord,
  emptyEvidenceLog,
} from "../../src/domain/evidence-schema.ts";

const validRecord = {
  contractDigest: "a".repeat(64),
  prooflineVersion: "0.1.0",
  criterionId: "tests-pass",
  verifierId: "unit",
  argv: ["bun", "test"],
  cwd: ".",
  result: "passed",
  exitCode: 0,
  durationMs: 1234,
  timestamp: "2026-08-02T00:00:00.000Z",
  outputBytes: 42,
  outputDigest: "b".repeat(64),
  outputPreview: "ok",
  truncated: false,
};

describe("evidence schema", () => {
  test("accepts a valid record", () => {
    expect(validateEvidenceRecord(validRecord).ok).toBe(true);
  });

  test("accepts a null exit code for timed-out / spawn-error results", () => {
    const r = validateEvidenceRecord({
      ...validRecord,
      result: "timed-out",
      exitCode: null,
    });
    expect(r.ok).toBe(true);
  });

  test("rejects an unknown result value", () => {
    expect(validateEvidenceRecord({ ...validRecord, result: "maybe" }).ok).toBe(false);
  });

  test("rejects unknown fields on a record", () => {
    expect(validateEvidenceRecord({ ...validRecord, secretEnv: "x" }).ok).toBe(false);
  });

  test("empty log is valid and versioned", () => {
    const log = emptyEvidenceLog();
    expect(log.version).toBe(1);
    expect(log.records).toEqual([]);
    expect(validateEvidenceLog(log).ok).toBe(true);
  });

  test("validates a populated log", () => {
    const log = { version: 1, records: [validRecord] };
    const r = validateEvidenceLog(log);
    expect(r.ok).toBe(true);
  });

  test("rejects a log with a bad record", () => {
    const log = { version: 1, records: [{ ...validRecord, result: "nope" }] };
    expect(validateEvidenceLog(log).ok).toBe(false);
  });
});
