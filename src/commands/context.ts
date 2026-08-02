import { buildContextPack } from "../domain/context-pack.ts";
import { loadEvidence } from "../storage/evidence-store.ts";
import { ExitCode } from "../cli/exit-codes.ts";
import { renderContext } from "../presentation/human.ts";
import { requireContract, type CommandContext, type CommandResult } from "../cli/command.ts";

/** `context`: render the compact, non-secret snapshot of remaining work. */
export async function runContext(ctx: CommandContext): Promise<CommandResult> {
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

  const pack = buildContextPack(loaded.contract, evidence.log.records, loaded.digest);
  return { code: ExitCode.OK, json: pack, human: renderContext(pack) };
}
