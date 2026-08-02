import { mkdir, rename, writeFile, open } from "node:fs/promises";
import path from "node:path";

/**
 * Write a file atomically: create a uniquely named temp file in the *same*
 * directory (so rename stays on one filesystem), fsync it, then rename over the
 * destination. A crash mid-write leaves either the old file or the new file,
 * never a partially written one.
 */
let counter = 0;

export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
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
