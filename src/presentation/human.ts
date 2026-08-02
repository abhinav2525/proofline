import type { Contract } from "../domain/contract-schema.ts";
import type { ContextPack } from "../domain/context-pack.ts";
import type { ObligationStatus } from "../domain/obligations.ts";

/**
 * Plain-text renderers for terminal output. No ANSI colour is used so output is
 * readable when piped or captured. These functions are pure: they take data and
 * return a string.
 */
const STATE_MARK: Record<ObligationStatus["state"], string> = {
  proven: "[proven ]",
  unproven: "[unproven]",
  failed: "[failed ]",
  blocked: "[blocked]",
};

export function renderStatus(
  contract: Contract,
  statuses: ObligationStatus[],
  ready: boolean,
): string {
  const lines: string[] = [];
  lines.push(`Outcome: ${contract.outcome}`);
  lines.push(`Mode:    ${contract.mode}`);
  lines.push("");
  lines.push("Criteria:");
  for (const s of statuses) {
    lines.push(`  ${STATE_MARK[s.state]} ${s.id} — ${s.description}`);
    for (const reason of s.reasons) {
      lines.push(`             · ${reason}`);
    }
  }
  lines.push("");
  lines.push(
    ready
      ? "All criteria are proven under the current contract."
      : "Delivery is NOT proven yet. (This is criterion state, not a finalization.)",
  );
  return lines.join("\n");
}

export function renderContext(pack: ContextPack): string {
  const lines: string[] = [];
  lines.push(`Outcome: ${pack.outcome}`);
  lines.push(`Mode:    ${pack.mode}`);
  if (pack.constraints.length) {
    lines.push("Constraints:");
    for (const c of pack.constraints) lines.push(`  - ${c}`);
  }
  lines.push("");
  if (pack.unprovenCriteria.length) {
    lines.push("Still to prove:");
    for (const c of pack.unprovenCriteria) {
      lines.push(`  - [${c.state}] ${c.id} — ${c.description}`);
    }
  } else {
    lines.push("Nothing left to prove.");
  }
  if (pack.openApprovals.length) {
    lines.push("");
    lines.push("Open approvals:");
    for (const a of pack.openApprovals) lines.push(`  - ${a.criterion}: ${a.description}`);
  }
  if (pack.latestEvidence.length) {
    lines.push("");
    lines.push("Recent evidence:");
    for (const e of pack.latestEvidence) {
      lines.push(
        `  - ${e.timestamp} ${e.criterionId}/${e.verifierId}: ${e.result} (${e.durationMs}ms)`,
      );
    }
  }
  return lines.join("\n");
}

export function renderValidationSuccess(contract: Contract, digest: string): string {
  return [
    "Contract is valid.",
    `  outcome:  ${contract.outcome}`,
    `  criteria: ${contract.criteria.length}`,
    `  verifiers: ${contract.verifiers.length}`,
    `  digest:   ${digest.slice(0, 12)}…`,
  ].join("\n");
}

export function renderIssues(header: string, issues: string[]): string {
  return [header, ...issues.map((i) => `  - ${i}`)].join("\n");
}
