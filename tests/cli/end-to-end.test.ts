import { afterEach, describe, expect, test } from "bun:test";
import { cp, readFile } from "node:fs/promises";
import path from "node:path";
import { cleanup, makeProject, runCli } from "./helpers.ts";

const FIXTURE = path.resolve(import.meta.dir, "../fixtures/sample-project");

const roots: string[] = [];
async function sampleProject(): Promise<string> {
  const root = await makeProject();
  await cp(FIXTURE, root, { recursive: true });
  roots.push(root);
  return root;
}
afterEach(async () => {
  while (roots.length) await cleanup(roots.pop()!);
});

describe("end-to-end: init -> brief -> validate -> context -> verify -> status", () => {
  test("drives the full flow on a disposable sample project", async () => {
    const root = await sampleProject();
    const answers = await readFile(path.join(root, "answers.json"), "utf8");

    // init
    expect((await runCli(["init"], { cwd: root })).code).toBe(0);

    // brief (non-interactive, from the sample answers)
    const brief = await runCli(["brief", "--json"], { cwd: root, stdin: answers });
    expect(brief.code).toBe(0);

    // validate
    expect((await runCli(["validate"], { cwd: root })).code).toBe(0);

    // context — outcome is visible, both criteria still to prove
    const ctx = await runCli(["context", "--json"], { cwd: root });
    expect(ctx.code).toBe(0);
    const pack = JSON.parse(ctx.stdout);
    expect(pack.outcome).toContain("Sample project");
    expect(pack.unprovenCriteria.map((c: { id: string }) => c.id).sort()).toEqual([
      "fail-check",
      "ok-check",
    ]);

    // verify — one passes, one fails; evidence recorded; exit 5
    const verify = await runCli(["verify", "--json"], { cwd: root });
    expect(verify.code).toBe(5);
    const vjson = JSON.parse(verify.stdout);
    expect(vjson.evidenceRecorded).toBe(2);

    // status — ok proven, fail failed, not ready (strict). Zero exit never claimed.
    const status = await runCli(["status", "--json"], { cwd: root });
    expect(status.code).toBe(1);
    const sjson = JSON.parse(status.stdout);
    expect(sjson.ready).toBe(false);
    const byId = Object.fromEntries(
      sjson.criteria.map((c: { id: string; state: string }) => [c.id, c.state]),
    );
    expect(byId["ok-check"]).toBe("proven");
    expect(byId["fail-check"]).toBe("failed");

    // re-verify only the passing criterion cleanly
    const reverify = await runCli(["verify", "--criterion", "ok-check", "--json"], {
      cwd: root,
    });
    expect(reverify.code).toBe(0);
  });
});
