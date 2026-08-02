import { afterEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanup, makeProject, runCli } from "./helpers.ts";

// An unlabelled, high-entropy token. There is no "key=" / "Bearer" marker, so
// regex redaction cannot recognise it — exactly the case that proves we must not
// persist verifier output at all. The verifier *reads it from a file* so the
// token appears only in runtime output, never in the contract/argv on disk.
const SECRET = "Zx9Qv2Lm8Kp4Rt7Wn3Bd6Fh1Jc5Gs0Ay8Ue4Ir2Ol";

const CONTRACT = `version: 1
outcome: evidence must not carry secrets
mode: strict
criteria:
  - id: c1
    description: emits an unlabelled secret-shaped string from a file
    verifiers:
      - leaky
verifiers:
  - id: leaky
    argv:
      - bun
      - -e
      - "process.stdout.write(await Bun.file('secret.txt').text())"
`;

const roots: string[] = [];
async function project(): Promise<string> {
  const root = await makeProject(CONTRACT);
  await writeFile(path.join(root, "secret.txt"), SECRET);
  roots.push(root);
  return root;
}
afterEach(async () => {
  while (roots.length) await cleanup(roots.pop()!);
});

describe("evidence never persists verifier output", () => {
  test("raw output and preview are absent from evidence.json; digest+bytes remain", async () => {
    const root = await project();
    const v = await runCli(["verify"], { cwd: root });
    expect(v.code).toBe(0); // the verifier itself exits 0

    const evidenceText = await readFile(
      path.join(root, ".proofline", "evidence.json"),
      "utf8",
    );

    // The secret-shaped output must not appear anywhere in persisted evidence.
    expect(evidenceText).not.toContain(SECRET);
    // No content-derived preview field is persisted at all.
    expect(evidenceText).not.toContain("outputPreview");
    // Structural, non-sensitive metadata is still there.
    expect(evidenceText).toContain("outputDigest");
    expect(evidenceText).toContain("outputBytes");

    const parsed = JSON.parse(evidenceText);
    const rec = parsed.records[0];
    expect(rec).not.toHaveProperty("outputPreview");
    expect(rec.outputBytes).toBe(SECRET.length);
    expect(rec.outputDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});
