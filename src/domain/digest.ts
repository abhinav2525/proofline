import { createHash } from "node:crypto";
import type { Contract } from "./contract-schema.ts";

/**
 * Produce a stable sha256 digest of a validated contract. Object keys are
 * sorted recursively so the digest depends only on content, not on YAML/JSON
 * key ordering. Evidence records embed this digest so `status` can tell whether
 * a proof still applies to the contract as it stands now.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sortedEntries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, v] of sortedEntries) out[k] = canonicalize(v);
    return out;
  }
  return value;
}

export function contractDigest(contract: Contract): string {
  const canonical = JSON.stringify(canonicalize(contract));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
