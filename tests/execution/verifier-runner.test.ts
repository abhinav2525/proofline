import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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

  test("truncates output but keeps the full-output digest and byte count", async () => {
    const r = await runVerifier(
      verifier({ argv: ["bun", "-e", "process.stdout.write('x'.repeat(100000))"] }),
      opts(),
    );
    expect(r.result).toBe("passed");
    expect(r.truncated).toBe(true);
    expect(r.outputBytes).toBeGreaterThanOrEqual(100000);
    expect(r.outputPreview.length).toBeLessThanOrEqual(200);
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

  test("does not leak parent environment secrets to the child", async () => {
    const script =
      "process.stdout.write(process.env.PROOFLINE_TEST_SECRET ? 'LEAK' : 'clean')";
    const r = await runVerifier(verifier({ argv: ["bun", "-e", script] }), {
      projectRoot: root,
      maxOutputBytes: 200,
      parentEnv: { PROOFLINE_TEST_SECRET: "hunter2", PATH: process.env.PATH ?? "" },
    });
    expect(r.outputPreview).toContain("clean");
    expect(r.outputPreview).not.toContain("LEAK");
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
