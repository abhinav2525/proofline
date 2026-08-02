import { allProven, computeObligations } from "../domain/obligations.ts";
import { loadEvidence } from "../storage/evidence-store.ts";
import { ExitCode } from "../cli/exit-codes.ts";
import { renderStatus } from "../presentation/human.ts";
import { requireContract, type CommandContext, type CommandResult } from "../cli/command.ts";

/**
 * `status`: report the state of every criterion. In strict mode a not-yet-proven
 * contract exits non-zero so it can gate scripts; in advisory mode it always
 * exits zero and simply reports. Either way, a zero exit is NOT a finalization
 * of delivery — it only means the declared criteria are currently proven.
 */
export async function runStatus(ctx: CommandContext): Promise<CommandResult> {
  const loaded = await requireContract(ctx);
  if (!loaded.ok) return loaded.result;

  const evidence = await loadEvidence(ctx.paths);
  if (!evidence.ok) {
    return {
      code: ExitCode.RUNTIME,
      json: { ok: false, message: evidence.message },
      stderr: `Could not read evidence: ${evidence.message}`,
    };
  }

  const statuses = computeObligations(
    loaded.contract,
    evidence.log.records,
    loaded.digest,
  );
  const ready = allProven(statuses);
  const notReadyCode =
    loaded.contract.mode === "strict" ? ExitCode.NOT_PROVEN : ExitCode.OK;

  return {
    code: ready ? ExitCode.OK : notReadyCode,
    json: {
      ready,
      mode: loaded.contract.mode,
      contractDigest: loaded.digest,
      criteria: statuses.map((s) => ({
        id: s.id,
        description: s.description,
        state: s.state,
        reasons: s.reasons,
      })),
    },
    human: renderStatus(loaded.contract, statuses, ready),
  };
}
