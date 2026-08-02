/**
 * Build a single-file, local macOS Apple Silicon executable.
 *
 * This intentionally targets only the local platform (bun-darwin-arm64) and
 * writes to ./dist. It does NOT publish, sign, notarize, or upload anything —
 * distribution is out of scope for v1 and requires a separate approval.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dir, "..");
const entry = path.join(projectRoot, "src/cli/main.ts");
const outfile = path.join(projectRoot, "dist/proofline");
const target = "bun-darwin-arm64";

await mkdir(path.join(projectRoot, "dist"), { recursive: true });

console.log(`Building ${outfile} for ${target}…`);
const proc = Bun.spawn(
  [
    "bun",
    "build",
    "--compile",
    `--target=${target}`,
    "--minify",
    entry,
    "--outfile",
    outfile,
  ],
  { cwd: projectRoot, stdout: "inherit", stderr: "inherit", stdin: "ignore" },
);

const code = await proc.exited;
if (code !== 0) {
  console.error(`Build failed with exit code ${code}`);
  process.exit(code);
}
console.log(`Built local artifact: ${outfile}`);
console.log("This binary is for local use only; it was not published or signed.");
