import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const MAIN = path.resolve(import.meta.dir, "../../src/cli/main.ts");

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the real Proofline entrypoint as a subprocess and capture its output. */
export async function runCli(
  args: string[],
  options: { cwd: string; env?: Record<string, string>; stdin?: string } = {
    cwd: process.cwd(),
  },
): Promise<CliRun> {
  const proc = Bun.spawn(["bun", "run", MAIN, ...args], {
    cwd: options.cwd,
    env: { PATH: process.env.PATH ?? "", ...options.env },
    stdout: "pipe",
    stderr: "pipe",
    stdin: options.stdin !== undefined ? Buffer.from(options.stdin) : "ignore",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/** Create a disposable project root, optionally seeded with a contract document. */
export async function makeProject(contractYaml?: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "proofline-cli-"));
  if (contractYaml !== undefined) {
    await mkdir(path.join(root, ".proofline"), { recursive: true });
    await writeFile(path.join(root, ".proofline", "delivery.yaml"), contractYaml);
  }
  return root;
}

export async function cleanup(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

export const VALID_CONTRACT = `version: 1
outcome: Ship the CLI
mode: strict
constraints:
  - stay offline
criteria:
  - id: unit
    description: unit tests pass
    verifiers:
      - v-unit
verifiers:
  - id: v-unit
    argv:
      - "true"
`;
