import path from "node:path";

/**
 * A verifier `cwd` is always interpreted relative to the project root. This
 * guard rejects anything that is absolute or that would resolve outside the
 * root once joined. It is intentionally conservative and platform-aware; the
 * runner enforces containment again at execution time as defense in depth.
 */
export function isSafeRelativePath(candidate: string): boolean {
  if (candidate.length === 0) return false;
  if (path.isAbsolute(candidate)) return false;
  // Reject Windows-style drive/UNC and backslash separators outright.
  if (/^[a-zA-Z]:/.test(candidate) || candidate.includes("\\")) return false;

  const normalized = path.posix.normalize(candidate);
  if (normalized === ".." || normalized.startsWith("../")) return false;
  return true;
}

/**
 * Resolve a project-relative path and confirm it stays within `root`.
 * Returns the absolute resolved path, or null if it would escape.
 *
 * This check is purely LEXICAL: it does not follow symlinks. A symlink inside
 * the root that points outside can pass this test yet really escape. Before
 * executing anything, the runner must additionally canonicalize both paths with
 * `realpath` and re-check containment (see `resolveContainedCwd` in
 * `src/execution/verifier-runner.ts`).
 */
export function resolveWithinRoot(root: string, relative: string): string | null {
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, relative);
  const rel = path.relative(absoluteRoot, resolved);
  if (rel === "") return resolved; // the root itself
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return null;
  }
  return resolved;
}
