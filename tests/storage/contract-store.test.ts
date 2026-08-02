import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prooflinePaths } from "../../src/storage/paths.ts";
import { loadContract, saveContract } from "../../src/storage/contract-store.ts";
import { validateContract } from "../../src/domain/contract-schema.ts";

const fixtures = path.resolve(import.meta.dir, "../fixtures");

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "proofline-store-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function sample() {
  const r = validateContract({
    version: 1,
    outcome: "round trip",
    mode: "strict",
    constraints: ["be nice"],
    criteria: [{ id: "c1", description: "d", verifiers: ["v1"] }],
    verifiers: [{ id: "v1", argv: ["echo", "hi"] }],
  });
  if (!r.ok) throw new Error("bad sample");
  return r.contract;
}

describe("contract-store", () => {
  test("reports missing when no contract exists", async () => {
    const result = await loadContract(prooflinePaths(root));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("missing");
  });

  test("saves a canonical document and loads it back equivalently", async () => {
    const paths = prooflinePaths(root);
    const contract = sample();
    await saveContract(paths, contract);

    const raw = await readFile(paths.contractPath, "utf8");
    expect(raw).toContain("outcome: round trip");
    // No aliases/anchors/tags should appear in a canonical write.
    expect(raw).not.toContain("&");
    expect(raw).not.toContain("*");

    const loaded = await loadContract(paths);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.contract).toEqual(contract);
    expect(loaded.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("loads the valid fixture", async () => {
    const paths = prooflinePaths(root);
    await mkdir(paths.dir, { recursive: true });
    await writeFile(
      paths.contractPath,
      await readFile(path.join(fixtures, "valid-delivery.yaml"), "utf8"),
    );
    const loaded = await loadContract(paths);
    expect(loaded.ok).toBe(true);
  });

  test.each([
    "unknown-field.yaml",
    "anchor-alias.yaml",
    "escaping-cwd.yaml",
  ])("rejects invalid fixture %s with diagnostics", async (name) => {
    const paths = prooflinePaths(root);
    await mkdir(paths.dir, { recursive: true });
    await writeFile(
      paths.contractPath,
      await readFile(path.join(fixtures, "invalid-deliveries", name), "utf8"),
    );
    const loaded = await loadContract(paths);
    expect(loaded.ok).toBe(false);
    if (loaded.ok || loaded.kind !== "invalid") throw new Error("expected invalid");
    expect(loaded.issues.length).toBeGreaterThan(0);
  });
});
