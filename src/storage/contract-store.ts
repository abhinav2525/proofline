import { readFile } from "node:fs/promises";
import { stringify } from "yaml";
import {
  validateContract,
  type Contract,
} from "../domain/contract-schema.ts";
import { contractDigest } from "../domain/digest.ts";
import { atomicWriteFile } from "./atomic-write.ts";
import type { ProoflinePaths } from "./paths.ts";
import { DEFAULT_MAX_BYTES, parseSafeYaml, SafeYamlError } from "./safe-yaml.ts";

export type LoadContractResult =
  | { ok: true; contract: Contract; digest: string }
  | { ok: false; kind: "missing" }
  | { ok: false; kind: "invalid"; issues: string[] }
  | { ok: false; kind: "read-error"; message: string };

function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && "code" in e;
}

export async function loadContract(
  paths: ProoflinePaths,
): Promise<LoadContractResult> {
  let text: string;
  try {
    text = await readFile(paths.contractPath, "utf8");
  } catch (e) {
    if (isErrnoException(e) && e.code === "ENOENT") {
      return { ok: false, kind: "missing" };
    }
    return {
      ok: false,
      kind: "read-error",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  let raw: unknown;
  try {
    raw = parseSafeYaml(text, { maxBytes: DEFAULT_MAX_BYTES });
  } catch (e) {
    if (e instanceof SafeYamlError) {
      return { ok: false, kind: "invalid", issues: [e.message] };
    }
    throw e;
  }

  const validated = validateContract(raw);
  if (!validated.ok) {
    return { ok: false, kind: "invalid", issues: validated.issues };
  }
  return {
    ok: true,
    contract: validated.contract,
    digest: contractDigest(validated.contract),
  };
}

const CONTRACT_HEADER = `# Proofline delivery contract — managed document.
# This file is written by \`proofline\` and validated on every read.
# Verifiers are argv arrays only; they are never interpreted by a shell.
`;

/** Serialize a validated contract to a canonical YAML document and write it atomically. */
export async function saveContract(
  paths: ProoflinePaths,
  contract: Contract,
): Promise<void> {
  const body = stringify(contract, {
    // A plain, canonical document: no anchors/aliases, stable formatting.
    aliasDuplicateObjects: false,
    lineWidth: 100,
  });
  await atomicWriteFile(paths.contractPath, `${CONTRACT_HEADER}${body}`);
}
