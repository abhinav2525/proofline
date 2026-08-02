import { readFile } from "node:fs/promises";
import {
  emptyEvidenceLog,
  validateEvidenceLog,
  type EvidenceLog,
  type EvidenceRecord,
} from "../domain/evidence-schema.ts";
import { atomicWriteFile } from "./atomic-write.ts";
import type { ProoflinePaths } from "./paths.ts";

const MAX_EVIDENCE_BYTES = 8_000_000; // Bounded so a runaway log cannot be read unboundedly.

export type LoadEvidenceResult =
  | { ok: true; log: EvidenceLog }
  | { ok: false; message: string };

function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && "code" in e;
}

export async function loadEvidence(
  paths: ProoflinePaths,
): Promise<LoadEvidenceResult> {
  let text: string;
  try {
    text = await readFile(paths.evidencePath, "utf8");
  } catch (e) {
    if (isErrnoException(e) && e.code === "ENOENT") {
      return { ok: true, log: emptyEvidenceLog() };
    }
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }

  if (Buffer.byteLength(text, "utf8") > MAX_EVIDENCE_BYTES) {
    return { ok: false, message: "evidence log exceeds the maximum readable size" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      message: `evidence log is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const validated = validateEvidenceLog(parsed);
  if (!validated.ok) {
    return { ok: false, message: `evidence log is invalid: ${validated.issues.join("; ")}` };
  }
  return { ok: true, log: validated.value };
}

/**
 * Append a single record. We read the existing log, push, and atomically
 * rewrite. Proofline is a single-user local tool; sequential verify runs make
 * this simple and safe without a lock.
 */
export async function appendEvidence(
  paths: ProoflinePaths,
  record: EvidenceRecord,
): Promise<void> {
  const existing = await loadEvidence(paths);
  if (!existing.ok) {
    throw new Error(
      `refusing to append to an unreadable evidence log: ${existing.message}`,
    );
  }
  const log = existing.log;
  log.records.push(record);
  await atomicWriteFile(paths.evidencePath, `${JSON.stringify(log, null, 2)}\n`);
}
