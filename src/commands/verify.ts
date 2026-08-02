import { appendEvidence } from "../storage/evidence-store.ts";
import {
  validateEvidenceRecord,
  type EvidenceRecord,
} from "../domain/evidence-schema.ts";
import { runVerifier } from "../execution/verifier-runner.ts";
import type { Contract, Verifier } from "../domain/contract-schema.ts";
import { ExitCode } from "../cli/exit-codes.ts";
import { VERSION } from "../version.ts";
import { requireContract, type CommandContext, type CommandResult } from "../cli/command.ts";

/**
 * Byte threshold above which a run's output is flagged `truncated`. Output is
 * never stored — only its digest and byte count — so this only affects the flag.
 */
const OUTPUT_CAP_BYTES = 1_000_000;

/** Resolve which criteria are in scope, honouring an optional --criterion filter. */
function selectCriteria(
  contract: Contract,
  requested: string[],
): { ok: true; criteria: Contract["criteria"] } | { ok: false; unknown: string[] } {
  if (requested.length === 0) return { ok: true, criteria: contract.criteria };
  const known = new Set(contract.criteria.map((c) => c.id));
  const unknown = requested.filter((id) => !known.has(id));
  if (unknown.length > 0) return { ok: false, unknown };
  const set = new Set(requested);
  return { ok: true, criteria: contract.criteria.filter((c) => set.has(c.id)) };
}

/** Resolve which verifiers to run, honouring an optional --verifier filter. */
function selectVerifierIds(
  criteria: Contract["criteria"],
  contract: Contract,
  requested: string[],
): { ok: true; ids: string[] } | { ok: false; unknown: string[] } {
  const referenced = new Set<string>();
  for (const c of criteria) for (const v of c.verifiers) referenced.add(v);

  if (requested.length > 0) {
    const known = new Set(contract.verifiers.map((v) => v.id));
    const unknown = requested.filter((id) => !known.has(id));
    if (unknown.length > 0) return { ok: false, unknown };
    return { ok: true, ids: requested.filter((id) => referenced.has(id)) };
  }
  // Preserve contract order for deterministic sequential execution.
  return {
    ok: true,
    ids: contract.verifiers.map((v) => v.id).filter((id) => referenced.has(id)),
  };
}

const usageError = (message: string): CommandResult => ({
  code: ExitCode.USAGE,
  json: { ok: false, reason: "usage", message },
  stderr: message,
});

/**
 * `verify`: run declared verifiers (validated argv arrays only, no shell) and
 * append non-secret evidence. Verifiers run sequentially. This command records
 * evidence about criteria; it never finalizes delivery — that is a human call,
 * and `status` reports the resulting state.
 */
export async function runVerify(ctx: CommandContext): Promise<CommandResult> {
  const loaded = await requireContract(ctx);
  if (!loaded.ok) return loaded.result;
  const { contract, digest } = loaded;

  const criteriaSel = selectCriteria(contract, ctx.cli.criteria);
  if (!criteriaSel.ok) {
    return usageError(`unknown criterion id(s): ${criteriaSel.unknown.join(", ")}`);
  }
  const verifierSel = selectVerifierIds(criteriaSel.criteria, contract, ctx.cli.verifiers);
  if (!verifierSel.ok) {
    return usageError(`unknown verifier id(s): ${verifierSel.unknown.join(", ")}`);
  }

  const byId = new Map<string, Verifier>(contract.verifiers.map((v) => [v.id, v]));
  const ran: Array<{
    verifierId: string;
    result: EvidenceRecord["result"];
    exitCode: number | null;
    durationMs: number;
    outputBytes: number;
    truncated: boolean;
  }> = [];
  let evidenceRecorded = 0;
  let anyFailure = false;
  // Terminal-only diagnostics (e.g. containment refusals). Never persisted.
  const diagnostics: string[] = [];

  for (const verifierId of verifierSel.ids) {
    const verifier = byId.get(verifierId);
    if (!verifier) continue; // unreachable: ids come from the contract

    const run = await runVerifier(verifier, {
      projectRoot: ctx.paths.root,
      maxOutputBytes: OUTPUT_CAP_BYTES,
    });
    if (run.result !== "passed") anyFailure = true;
    if (run.diagnostic) diagnostics.push(`${verifierId}: ${run.diagnostic}`);
    ran.push({
      verifierId,
      result: run.result,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      outputBytes: run.outputBytes,
      truncated: run.truncated,
    });

    // One run backs every in-scope criterion that references this verifier.
    const owners = criteriaSel.criteria.filter((c) => c.verifiers.includes(verifierId));
    for (const criterion of owners) {
      const record: EvidenceRecord = {
        contractDigest: digest,
        prooflineVersion: VERSION,
        criterionId: criterion.id,
        verifierId,
        argv: verifier.argv,
        cwd: verifier.cwd,
        result: run.result,
        exitCode: run.exitCode,
        durationMs: run.durationMs,
        timestamp: new Date().toISOString(),
        outputBytes: run.outputBytes,
        outputDigest: run.outputDigest,
        truncated: run.truncated,
      };
      const check = validateEvidenceRecord(record);
      if (!check.ok) {
        return {
          code: ExitCode.RUNTIME,
          json: { ok: false, issues: check.issues },
          stderr: `internal error: built an invalid evidence record: ${check.issues.join("; ")}`,
        };
      }
      await appendEvidence(ctx.paths, record);
      evidenceRecorded += 1;
    }
  }

  const humanLines = [
    `Ran ${ran.length} verifier(s); recorded ${evidenceRecorded} evidence record(s).`,
    ...ran.map(
      (x) => `  ${x.result === "passed" ? "✓" : "✗"} ${x.verifierId}: ${x.result} (${x.durationMs}ms)`,
    ),
    "",
    "Evidence recorded. Run `proofline status` to see criterion state.",
    "(A passing verifier is evidence, not a finalization of delivery.)",
  ];

  return {
    code: anyFailure ? ExitCode.VERIFY_FAILED : ExitCode.OK,
    json: { ok: !anyFailure, contractDigest: digest, ran, evidenceRecorded },
    human: humanLines.join("\n"),
    stderr: diagnostics.length ? diagnostics.join("\n") : undefined,
  };
}
