import { z } from "zod";

/**
 * Evidence is an append-only, non-secret record of what a verifier did. It
 * stores a bounded, redacted output preview plus a digest of the full output —
 * never raw secrets, never the inherited environment. The contract digest ties
 * each record to the exact contract that was in effect.
 */

export const VERIFIER_RESULTS = [
  "passed",
  "failed",
  "timed-out",
  "spawn-error",
] as const;
export type VerifierResult = (typeof VERIFIER_RESULTS)[number];

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "expected a sha256 hex digest");

export const evidenceRecordSchema = z.strictObject({
  contractDigest: sha256Hex,
  prooflineVersion: z.string().min(1).max(32),
  criterionId: z.string().min(1).max(64),
  verifierId: z.string().min(1).max(64),
  argv: z.array(z.string()).min(1).max(64),
  cwd: z.string().max(256),
  result: z.enum(VERIFIER_RESULTS),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative(),
  timestamp: z.iso.datetime(),
  outputBytes: z.number().int().nonnegative(),
  outputDigest: sha256Hex,
  outputPreview: z.string(),
  truncated: z.boolean(),
});

export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;

export const evidenceLogSchema = z.strictObject({
  version: z.literal(1),
  records: z.array(evidenceRecordSchema).max(10_000),
});

export type EvidenceLog = z.infer<typeof evidenceLogSchema>;

export function emptyEvidenceLog(): EvidenceLog {
  return { version: 1, records: [] };
}

type Result<T> = { ok: true; value: T } | { ok: false; issues: string[] };

function toResult<T>(parsed: z.ZodSafeParseResult<T>): Result<T> {
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map(
      (i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`,
    ),
  };
}

export function validateEvidenceRecord(data: unknown): Result<EvidenceRecord> {
  return toResult(evidenceRecordSchema.safeParse(data));
}

export function validateEvidenceLog(data: unknown): Result<EvidenceLog> {
  return toResult(evidenceLogSchema.safeParse(data));
}
