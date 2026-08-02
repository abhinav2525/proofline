import { createHash } from "node:crypto";
import type { Verifier } from "../domain/contract-schema.ts";
import type { VerifierResult } from "../domain/evidence-schema.ts";
import { resolveWithinRoot } from "../domain/paths-safety.ts";
import { redactSecrets } from "./redact.ts";

/**
 * The verifier runner is the only place Proofline executes anything. It runs a
 * *validated argv array* — never a shell string — inside the project root, with:
 *
 *   - a minimal, allowlisted environment (parent secrets are not inherited),
 *   - a hard timeout,
 *   - bounded, redacted output capture (with a digest of the full output),
 *   - strict root containment for the working directory.
 *
 * A result here is evidence about one check. It is never a finalization.
 */

/** Environment variables a child may inherit. Everything else is dropped. */
export const DEFAULT_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TZ",
  "TERM",
] as const;

export class VerifierCancelledError extends Error {
  override name = "VerifierCancelledError";
}

export interface RunOptions {
  projectRoot: string;
  /** Max bytes of output kept as a (redacted) preview. */
  maxOutputBytes: number;
  /** Source of environment values; defaults to process.env. */
  parentEnv?: Record<string, string | undefined>;
  /** Keys allowed through to the child; defaults to DEFAULT_ENV_ALLOWLIST. */
  envAllowlist?: readonly string[];
  signal?: AbortSignal;
}

export interface VerifierRunResult {
  result: VerifierResult;
  exitCode: number | null;
  durationMs: number;
  outputBytes: number;
  outputDigest: string;
  outputPreview: string;
  truncated: boolean;
}

function buildChildEnv(options: RunOptions): Record<string, string> {
  const source = options.parentEnv ?? process.env;
  const allow = options.envAllowlist ?? DEFAULT_ENV_ALLOWLIST;
  const env: Record<string, string> = {};
  for (const key of allow) {
    const value = source[key];
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function spawnErrorResult(durationMs: number, note: string): VerifierRunResult {
  const redacted = redactSecrets(note);
  return {
    result: "spawn-error",
    exitCode: null,
    durationMs,
    outputBytes: Buffer.byteLength(redacted, "utf8"),
    outputDigest: createHash("sha256").update(redacted, "utf8").digest("hex"),
    outputPreview: redacted,
    truncated: false,
  };
}

export async function runVerifier(
  verifier: Verifier,
  options: RunOptions,
): Promise<VerifierRunResult> {
  const start = Date.now();
  if (options.signal?.aborted) {
    throw new VerifierCancelledError("verifier run cancelled before start");
  }

  const cwd = resolveWithinRoot(options.projectRoot, verifier.cwd);
  if (cwd === null) {
    return spawnErrorResult(
      Date.now() - start,
      `refused: cwd '${verifier.cwd}' escapes the project root`,
    );
  }

  // Incremental hash over the full output; a small capped preview for evidence.
  const hash = createHash("sha256");
  let totalBytes = 0;
  let preview = Buffer.alloc(0);
  const cap = options.maxOutputBytes;
  const consume = (chunk: Uint8Array): void => {
    hash.update(chunk);
    totalBytes += chunk.length;
    if (preview.length < cap) {
      const room = cap - preview.length;
      preview = Buffer.concat([preview, Buffer.from(chunk.subarray(0, room))]);
    }
  };

  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn(verifier.argv, {
      cwd,
      env: buildChildEnv(options),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (e) {
    return spawnErrorResult(
      Date.now() - start,
      `failed to spawn: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  let timedOut = false;
  let cancelled = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill(9);
  }, verifier.timeoutMs);

  const onAbort = (): void => {
    cancelled = true;
    proc.kill(9);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const readStream = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    for await (const chunk of stream) consume(chunk);
  };

  try {
    await Promise.all([readStream(proc.stdout), readStream(proc.stderr)]);
    await proc.exited;
  } catch (e) {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    if (cancelled) throw new VerifierCancelledError("verifier run cancelled");
    return spawnErrorResult(
      Date.now() - start,
      `execution error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  clearTimeout(timer);
  options.signal?.removeEventListener("abort", onAbort);

  if (cancelled) throw new VerifierCancelledError("verifier run cancelled");

  const durationMs = Date.now() - start;
  const previewText = redactSecrets(preview.toString("utf8"));

  let result: VerifierResult;
  if (timedOut) {
    result = "timed-out";
  } else if (proc.exitCode === 0) {
    result = "passed";
  } else {
    result = "failed";
  }

  return {
    result,
    exitCode: proc.exitCode,
    durationMs,
    outputBytes: totalBytes,
    outputDigest: hash.digest("hex"),
    outputPreview: previewText,
    truncated: totalBytes > cap,
  };
}
