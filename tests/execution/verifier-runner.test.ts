import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  runVerifier,
  VerifierCancelledError,
} from "../../src/execution/verifier-runner.ts";
import type { Verifier } from "../../src/domain/contract-schema.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "proofline-run-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function verifier(partial: Partial<Verifier> & Pick<Verifier, "argv">): Verifier {
  return { id: "v", cwd: ".", timeoutMs: 5000, ...partial };
}

const opts = () => ({ projectRoot: root, maxOutputBytes: 200 });

describe("runVerifier", () => {
  test("passes on exit 0 and records a digest", async () => {
    const r = await runVerifier(verifier({ argv: ["bun", "-e", "process.exit(0)"] }), opts());
    expect(r.result).toBe("passed");
    expect(r.exitCode).toBe(0);
    expect(r.outputDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("fails on a non-zero exit", async () => {
    const r = await runVerifier(verifier({ argv: ["bun", "-e", "process.exit(3)"] }), opts());
    expect(r.result).toBe("failed");
    expect(r.exitCode).toBe(3);
  });

  test("reports spawn-error for an unknown program", async () => {
    const r = await runVerifier(
      verifier({ argv: ["proofline-no-such-binary-xyz"] }),
      opts(),
    );
    expect(r.result).toBe("spawn-error");
    expect(r.exitCode).toBeNull();
  });

  test("times out a long-running command", async () => {
    const r = await runVerifier(
      verifier({ argv: ["bun", "-e", "await Bun.sleep(10000)"], timeoutMs: 150 }),
      opts(),
    );
    expect(r.result).toBe("timed-out");
  });

  test("on timeout it kills descendants and does not block on their pipes", async () => {
    // The direct child spawns a grandchild that inherits our stdout pipe, sleeps,
    // and only then writes a marker. If we kill just the direct child, the
    // grandchild keeps the pipe open (blocking our reads) and runs to completion.
    const marker = path.join(root, "gc-marker.txt");
    const inner = "await Bun.sleep(3000); await Bun.write('gc-marker.txt','x')";
    const script =
      `const gc = Bun.spawn(['bun','-e',${JSON.stringify(inner)}], ` +
      `{ stdout: 'inherit', stderr: 'inherit' }); await gc.exited;`;

    const began = Date.now();
    const r = await runVerifier(
      verifier({ argv: ["bun", "-e", script], timeoutMs: 300 }),
      { projectRoot: root, maxOutputBytes: 200 },
    );
    const elapsed = Date.now() - began;

    expect(r.result).toBe("timed-out");
    // Must not wait ~3s for the grandchild to finish holding the pipe.
    expect(elapsed).toBeLessThan(2200);
    // The descendant was terminated before it could write its marker.
    expect(existsSync(marker)).toBe(false);
  });

  test("keeps a full-output digest and byte count without retaining the output", async () => {
    const r = await runVerifier(
      verifier({ argv: ["bun", "-e", "process.stdout.write('x'.repeat(100000))"] }),
      opts(),
    );
    expect(r.result).toBe("passed");
    // No output/preview is exposed at all — only structural metadata.
    expect(r).not.toHaveProperty("outputPreview");
    expect(r.outputBytes).toBe(100000);
    // Digest covers the full output even though the output is never stored.
    const expected = createHash("sha256").update("x".repeat(100000)).digest("hex");
    expect(r.outputDigest).toBe(expected);
    // Output exceeded the byte cap, so it is flagged truncated for the reader.
    expect(r.truncated).toBe(true);
  });

  test("refuses a cwd that escapes the project root", async () => {
    const r = await runVerifier(
      verifier({ argv: ["bun", "-e", "process.exit(0)"], cwd: ".." }),
      { projectRoot: path.join(root, "nested"), maxOutputBytes: 200 },
    );
    // '..' from <root>/nested resolves to <root>, still contained -> allowed.
    // Force a real escape instead:
    const escaped = await runVerifier(
      verifier({ argv: ["bun", "-e", "process.exit(0)"], cwd: ".." }),
      { projectRoot: root, maxOutputBytes: 200 },
    );
    expect(escaped.result).toBe("spawn-error");
    void r;
  });

  test("refuses a cwd that reaches outside the root via an internal symlink", async () => {
    // A symlink *inside* the project root that points to an external directory
    // is lexically contained but really escapes. The command must not run.
    const external = await mkdtemp(path.join(tmpdir(), "proofline-external-"));
    try {
      const link = path.join(root, "escape");
      await symlink(external, link, "dir");
      const marker = path.join(external, "ran-marker.txt");

      const r = await runVerifier(
        verifier({
          argv: ["bun", "-e", "await Bun.write('ran-marker.txt', 'x')"],
          cwd: "escape",
        }),
        { projectRoot: root, maxOutputBytes: 200 },
      );

      expect(r.result).toBe("spawn-error");
      // Prove no command executed in the external directory.
      expect(existsSync(marker)).toBe(false);
    } finally {
      await rm(external, { recursive: true, force: true });
    }
  });

  test("does not leak parent environment secrets to the child", async () => {
    const script =
      "process.stdout.write(process.env.PROOFLINE_TEST_SECRET ? 'LEAK' : 'clean')";
    const r = await runVerifier(verifier({ argv: ["bun", "-e", script] }), {
      projectRoot: root,
      maxOutputBytes: 200,
      parentEnv: { PROOFLINE_TEST_SECRET: "hunter2", PATH: process.env.PATH ?? "" },
    });
    // Output is never retained, so assert via the digest: the child emitted
    // 'clean' (secret absent), not 'LEAK' (secret inherited).
    expect(r.outputDigest).toBe(createHash("sha256").update("clean").digest("hex"));
    expect(r.outputDigest).not.toBe(createHash("sha256").update("LEAK").digest("hex"));
    expect(r.outputBytes).toBe("clean".length);
  });

  test("throws VerifierCancelledError when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runVerifier(verifier({ argv: ["bun", "-e", "await Bun.sleep(5000)"] }), {
        ...opts(),
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(VerifierCancelledError);
  });
});
