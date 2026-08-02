import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
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

/**
 * After the timeout fires we kill the whole process group; give descendants a
 * bounded grace to release the stdio pipes, then stop waiting no matter what.
 * This guarantees `verify` can never block indefinitely on an inherited pipe.
 */
const DRAIN_GRACE_MS = 1500;

/**
 * Force-terminate the verifier and everything it spawned.
 *
 * The child is spawned `detached`, so on POSIX it is its own process-group
 * leader (setsid) and `process.kill(-pid, "SIGKILL")` reaps the entire group —
 * grandchildren included. If that is unavailable (already gone, or a non-POSIX
 * platform), we fall back to force-killing at least the direct child.
 */
function killProcessGroup(proc: Bun.Subprocess): void {
  try {
    process.kill(-proc.pid, "SIGKILL");
  } catch {
    try {
      proc.kill(9);
    } catch {
      /* already dead */
    }
  }
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
  /** Total bytes of output produced (stdout+stderr). Not persisted verbatim. */
  outputBytes: number;
  /** sha256 of the full captured output. The output itself is never stored. */
  outputDigest: string;
  truncated: boolean;
  /**
   * A short, redacted, terminal-only diagnostic (e.g. a containment refusal
   * reason). It is NOT verifier output and is never written to evidence.
   */
  diagnostic?: string;
}

const EMPTY_OUTPUT_DIGEST = createHash("sha256").update("").digest("hex");

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

type CwdResolution = { ok: true; cwd: string } | { ok: false; reason: string };

/**
 * Resolve the verifier working directory and confirm real containment.
 *
 * Lexical checks alone are unsafe: a symlink *inside* the project root that
 * points elsewhere passes a `path.relative` test yet makes the child run
 * outside the root. So we canonicalize both the project root and the resolved
 * cwd with `realpath` and require the real cwd to sit within the real root.
 * Missing paths become a controlled refusal — never a weakened check.
 */
async function resolveContainedCwd(
  projectRoot: string,
  relativeCwd: string,
): Promise<CwdResolution> {
  const lexical = resolveWithinRoot(projectRoot, relativeCwd);
  if (lexical === null) {
    return { ok: false, reason: `cwd '${relativeCwd}' escapes the project root` };
  }

  let realRoot: string;
  try {
    realRoot = await realpath(projectRoot);
  } catch {
    return { ok: false, reason: "project root does not exist" };
  }

  let realCwd: string;
  try {
    realCwd = await realpath(lexical);
  } catch {
    return { ok: false, reason: `cwd '${relativeCwd}' does not exist` };
  }

  const rel = path.relative(realRoot, realCwd);
  const escapes =
    rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  if (rel !== "" && escapes) {
    return { ok: false, reason: `cwd '${relativeCwd}' resolves outside the project root` };
  }
  return { ok: true, cwd: realCwd };
}

function spawnErrorResult(durationMs: number, note: string): VerifierRunResult {
  // A spawn-error produces no verifier output; the note is our own message and
  // is surfaced only as a terminal diagnostic, never persisted.
  return {
    result: "spawn-error",
    exitCode: null,
    durationMs,
    outputBytes: 0,
    outputDigest: EMPTY_OUTPUT_DIGEST,
    truncated: false,
    diagnostic: redactSecrets(note),
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

  const contained = await resolveContainedCwd(options.projectRoot, verifier.cwd);
  if (!contained.ok) {
    return spawnErrorResult(Date.now() - start, `refused: ${contained.reason}`);
  }
  const cwd = contained.cwd;

  // Incremental hash over the full output; the output itself is never retained.
  // Only a digest and byte count leave this function.
  const hash = createHash("sha256");
  let totalBytes = 0;
  const cap = options.maxOutputBytes;
  const consume = (chunk: Uint8Array): void => {
    hash.update(chunk);
    totalBytes += chunk.length;
  };

  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn(verifier.argv, {
      cwd,
      env: buildChildEnv(options),
      // Own process group so a timeout can reap the whole subtree, not just the
      // direct child (which would leave descendants holding the stdio pipes).
      detached: true,
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
    killProcessGroup(proc);
  }, verifier.timeoutMs);

  const onAbort = (): void => {
    cancelled = true;
    killProcessGroup(proc);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const readStream = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    for await (const chunk of stream) consume(chunk);
  };

  // Read both pipes and wait for exit, but never longer than the timeout plus a
  // bounded drain grace. If descendants keep a pipe open past that, we abandon
  // the read (and force-kill the group again) rather than block verify forever.
  let readsSettled = false;
  const readAll = Promise.all([readStream(proc.stdout), readStream(proc.stderr)]);
  let completionError: unknown = null;
  const completion = (async () => {
    try {
      await readAll;
      await proc.exited;
    } catch (e) {
      completionError = e;
    } finally {
      readsSettled = true;
    }
  })();

  let drainAbandoned = false;
  await Promise.race([
    completion,
    (async () => {
      const remaining = verifier.timeoutMs + DRAIN_GRACE_MS - (Date.now() - start);
      await Bun.sleep(Math.max(0, remaining));
      if (!readsSettled) drainAbandoned = true;
    })(),
  ]);

  clearTimeout(timer);
  options.signal?.removeEventListener("abort", onAbort);

  if (drainAbandoned) {
    // A descendant is still holding a pipe. Stop reading and ensure the group
    // is gone; classify as timed-out since the check did not complete cleanly.
    timedOut = true;
    killProcessGroup(proc);
    await proc.stdout.cancel().catch(() => {});
    await proc.stderr.cancel().catch(() => {});
  }

  if (cancelled) throw new VerifierCancelledError("verifier run cancelled");

  if (completionError && !timedOut) {
    return spawnErrorResult(
      Date.now() - start,
      `execution error: ${completionError instanceof Error ? completionError.message : String(completionError)}`,
    );
  }

  const durationMs = Date.now() - start;

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
    truncated: totalBytes > cap || drainAbandoned,
  };
}
