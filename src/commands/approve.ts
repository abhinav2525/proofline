import { validateContract } from "../domain/contract-schema.ts";
import { saveContract } from "../storage/contract-store.ts";
import { ExitCode } from "../cli/exit-codes.ts";
import { requireContract, type CommandContext, type CommandResult } from "../cli/command.ts";

const usageError = (message: string): CommandResult => ({
  code: ExitCode.USAGE,
  json: { ok: false, reason: "usage", message },
  stderr: message,
});

/**
 * `approve`: record a human approval for a criterion that requires one.
 *
 * This is a delivery decision made by a person, captured with the same atomic,
 * validated contract-write path as `brief`. It never runs verifiers and never
 * finalizes delivery — it only appends one approval record. Because the
 * verification digest excludes approvals, granting an approval turns a `blocked`
 * criterion `proven` without invalidating its passing verifier evidence.
 */
export async function runApprove(ctx: CommandContext): Promise<CommandResult> {
  const loaded = await requireContract(ctx);
  if (!loaded.ok) return loaded.result;
  const { contract } = loaded;

  const criterionId = ctx.cli.positionals[0];
  if (criterionId === undefined) {
    return usageError("usage: proofline approve <criterion> --by <name> [--note <note>]");
  }

  const by = (ctx.cli.by ?? "").trim();
  if (by.length === 0) {
    return usageError("--by <name> is required and must not be empty");
  }
  const note = ctx.cli.note?.trim();

  const criterion = contract.criteria.find((c) => c.id === criterionId);
  if (!criterion) {
    return usageError(`unknown criterion: ${criterionId}`);
  }
  if (!criterion.requiresApproval) {
    return usageError(`criterion '${criterionId}' does not require approval`);
  }
  if (contract.approvals.some((a) => a.criterion === criterionId)) {
    return usageError(`criterion '${criterionId}' is already approved`);
  }

  const next = {
    ...contract,
    approvals: [
      ...contract.approvals,
      note && note.length > 0
        ? { criterion: criterionId, by, note }
        : { criterion: criterionId, by },
    ],
  };

  // Re-validate the whole document before writing: enforces field bounds
  // (e.g. `by` length) and keeps the on-disk contract provably well-formed.
  const validated = validateContract(next);
  if (!validated.ok) {
    return usageError(`approval is invalid: ${validated.issues.join("; ")}`);
  }

  await saveContract(ctx.paths, validated.contract);

  return {
    code: ExitCode.OK,
    json: { ok: true, criterion: criterionId, by, note: note || undefined },
    human:
      `Recorded approval of '${criterionId}' by ${by}.\n` +
      "Run `proofline status` to see criterion state.\n" +
      "(Approval is a human delivery decision; it does not finalize delivery.)",
  };
}
