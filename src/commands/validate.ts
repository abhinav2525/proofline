import { loadContract } from "../storage/contract-store.ts";
import { ExitCode } from "../cli/exit-codes.ts";
import { renderIssues, renderValidationSuccess } from "../presentation/human.ts";
import type { CommandContext, CommandResult } from "../cli/command.ts";

/** `validate`: read the contract and report whether it is well-formed. */
export async function runValidate(ctx: CommandContext): Promise<CommandResult> {
  const loaded = await loadContract(ctx.paths);

  if (loaded.ok) {
    return {
      code: ExitCode.OK,
      json: {
        ok: true,
        digest: loaded.digest,
        outcome: loaded.contract.outcome,
        criteria: loaded.contract.criteria.length,
        verifiers: loaded.contract.verifiers.length,
      },
      human: renderValidationSuccess(loaded.contract, loaded.digest),
    };
  }

  if (loaded.kind === "missing") {
    return {
      code: ExitCode.NO_CONTRACT,
      json: { ok: false, kind: "missing" },
      stderr: "No delivery contract found at .proofline/delivery.yaml.",
    };
  }
  if (loaded.kind === "invalid") {
    return {
      code: ExitCode.INVALID_CONTRACT,
      json: { ok: false, kind: "invalid", issues: loaded.issues },
      stderr: renderIssues("Contract is invalid:", loaded.issues),
    };
  }
  return {
    code: ExitCode.RUNTIME,
    json: { ok: false, kind: "read-error", message: loaded.message },
    stderr: `Could not read contract: ${loaded.message}`,
  };
}
