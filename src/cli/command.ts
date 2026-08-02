import type { ParsedCli } from "./args.ts";
import { ExitCode } from "./exit-codes.ts";
import { loadContract } from "../storage/contract-store.ts";
import { renderIssues } from "../presentation/human.ts";
import type { Contract } from "../domain/contract-schema.ts";
import { prooflinePaths, type ProoflinePaths } from "../storage/paths.ts";

export interface CommandResult {
  code: number;
  /** Rendered text for human mode (stdout). */
  human?: string;
  /** Structured value for `--json` mode (stdout). */
  json?: unknown;
  /** Diagnostics, printed to stderr in either mode. */
  stderr?: string;
}

export interface CommandContext {
  cli: ParsedCli;
  paths: ProoflinePaths;
}

export function contextFor(cli: ParsedCli): CommandContext {
  return { cli, paths: prooflinePaths(cli.root) };
}

/**
 * Load a contract for a command, turning the "missing"/"invalid" cases into a
 * ready-to-return CommandResult so every command reports these the same way.
 */
export type LoadedContract =
  | { ok: true; contract: Contract; digest: string }
  | { ok: false; result: CommandResult };

export async function requireContract(
  ctx: CommandContext,
): Promise<LoadedContract> {
  const loaded = await loadContract(ctx.paths);
  if (loaded.ok) {
    return { ok: true, contract: loaded.contract, digest: loaded.digest };
  }

  if (loaded.kind === "missing") {
    return {
      ok: false,
      result: {
        code: ExitCode.NO_CONTRACT,
        json: { ok: false, kind: "missing", message: "no contract found" },
        stderr:
          "No delivery contract found. Run `proofline init` then `proofline brief`.",
      },
    };
  }
  if (loaded.kind === "invalid") {
    return {
      ok: false,
      result: {
        code: ExitCode.INVALID_CONTRACT,
        json: { ok: false, kind: "invalid", issues: loaded.issues },
        stderr: renderIssues("Contract is invalid:", loaded.issues),
      },
    };
  }
  return {
    ok: false,
    result: {
      code: ExitCode.RUNTIME,
      json: { ok: false, kind: "read-error", message: loaded.message },
      stderr: `Could not read contract: ${loaded.message}`,
    },
  };
}
