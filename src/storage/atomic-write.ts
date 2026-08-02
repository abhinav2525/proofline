import { mkdir, rename, writeFile, open, realpath } from "node:fs/promises";
import path from "node:path";

/**
 * Write a file atomically: create a uniquely named temp file in the *same*
 * directory (so rename stays on one filesystem), fsync it, then rename over the
 * destination. A crash mid-write leaves either the old file or the new file,
 * never a partially written one.
 *
 * Every write is bounded to a containment `root`. Before writing we canonicalize
 * the deepest existing ancestor of the target directory with `realpath` and
 * require it to sit inside the real `root`. This defeats a symlinked
 * `.proofline` (or any ancestor) that would otherwise redirect contract or
 * evidence writes outside the project. The check is by real path, not lexical.
 */
let counter = 0;

export class WriteContainmentError extends Error {
  override name = "WriteContainmentError";
}

/** Realpath of the deepest existing ancestor of `target` (which may not exist). */
async function realDeepestExisting(target: string): Promise<string> {
  let current = path.resolve(target);
  for (;;) {
    try {
      return await realpath(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new WriteContainmentError(`no existing ancestor for ${target}`);
      }
      current = parent;
    }
  }
}

async function assertContained(root: string, filePath: string): Promise<void> {
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    throw new WriteContainmentError(`project root does not exist: ${root}`);
  }

  const dir = path.dirname(path.resolve(filePath));
  const realDir = await realDeepestExisting(dir);
  const rel = path.relative(realRoot, realDir);
  const escapes =
    rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  if (rel !== "" && escapes) {
    throw new WriteContainmentError(
      `refused: write target '${filePath}' resolves outside the project root`,
    );
  }
}

export async function atomicWriteFile(
  filePath: string,
  data: string,
  root: string,
): Promise<void> {
  // Enforce real-path containment before creating or writing anything.
  await assertContained(root, filePath);

  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });

  const unique = `${process.pid}-${Date.now()}-${counter++}`;
  const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp-${unique}`);

  await writeFile(tempPath, data, { encoding: "utf8", mode: 0o600 });
  // fsync the temp file so its contents are durable before the rename.
  const handle = await open(tempPath, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, filePath);
}
