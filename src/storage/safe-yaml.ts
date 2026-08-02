import { isAlias, parseAllDocuments, visit, type Node } from "yaml";

/**
 * A deliberately restricted YAML profile for reading contracts. YAML is a large
 * language; most of it is unnecessary for a contract and some of it is a
 * liability. We accept exactly one plain document and reject:
 *
 *   - multiple documents
 *   - anchors and aliases (can create huge structures / confuse review)
 *   - explicit custom tags (can drive non-obvious type coercion)
 *   - documents larger than a byte cap
 *
 * Everything else is a parse error surfaced as a SafeYamlError.
 */
export const DEFAULT_MAX_BYTES = 1_000_000; // 1 MiB is far more than any real contract.

export class SafeYamlError extends Error {
  override name = "SafeYamlError";
}

export interface SafeYamlOptions {
  maxBytes?: number;
}

export function parseSafeYaml(text: string, options: SafeYamlOptions = {}): unknown {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > maxBytes) {
    throw new SafeYamlError(
      `document is ${byteLength} bytes, exceeding the ${maxBytes} byte limit`,
    );
  }

  const docs = parseAllDocuments(text, {
    // Core schema only; do not merge keys or resolve custom tags for us.
    schema: "core",
    merge: false,
  });

  if (docs.length === 0) {
    throw new SafeYamlError("no YAML document found");
  }
  if (docs.length > 1) {
    throw new SafeYamlError("multiple YAML documents are not allowed; provide exactly one");
  }

  const doc = docs[0]!;
  if (doc.errors.length > 0) {
    throw new SafeYamlError(doc.errors[0]!.message);
  }

  visit(doc, {
    Alias() {
      throw new SafeYamlError("YAML aliases are not allowed");
    },
    Node(_key, node: Node) {
      if (isAlias(node)) {
        throw new SafeYamlError("YAML aliases are not allowed");
      }
      if (node.anchor) {
        throw new SafeYamlError("YAML anchors are not allowed");
      }
      const tag = node.tag;
      if (typeof tag === "string" && tag.startsWith("!")) {
        throw new SafeYamlError(`custom YAML tag is not allowed: ${tag}`);
      }
    },
  });

  const value = doc.toJS({ maxAliasCount: 0 });
  if (value === null || value === undefined) {
    throw new SafeYamlError("document is empty");
  }
  return value;
}
