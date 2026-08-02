import type { Contract } from "./contract-schema.ts";
import type { EvidenceRecord, VerifierResult } from "./evidence-schema.ts";
import {
  computeObligations,
  type CriterionState,
} from "./obligations.ts";

/**
 * The context pack is the compact, non-secret snapshot an agent or human needs
 * to know "what still has to be proven and what just happened." It deliberately
 * omits raw logs, output previews, and full status history — only the current
 * outcome, constraints, unproven criteria, a few recent evidence summaries, and
 * open approvals.
 */
export interface ContextEvidenceSummary {
  criterionId: string;
  verifierId: string;
  result: VerifierResult;
  timestamp: string;
  durationMs: number;
}

export interface ContextUnprovenCriterion {
  id: string;
  description: string;
  state: CriterionState;
  reasons: string[];
}

export interface ContextOpenApproval {
  criterion: string;
  description: string;
}

export interface ContextPack {
  outcome: string;
  mode: Contract["mode"];
  contractDigest: string;
  constraints: string[];
  unprovenCriteria: ContextUnprovenCriterion[];
  latestEvidence: ContextEvidenceSummary[];
  openApprovals: ContextOpenApproval[];
}

const MAX_RECENT_EVIDENCE = 5;

export function buildContextPack(
  contract: Contract,
  records: EvidenceRecord[],
  digest: string,
): ContextPack {
  const obligations = computeObligations(contract, records, digest);

  const unprovenCriteria = obligations
    .filter((o) => o.state !== "proven")
    .map((o) => ({
      id: o.id,
      description: o.description,
      state: o.state,
      reasons: o.reasons,
    }));

  const approved = new Set(contract.approvals.map((a) => a.criterion));
  const openApprovals = contract.criteria
    .filter((c) => c.requiresApproval && !approved.has(c.id))
    .map((c) => ({ criterion: c.id, description: c.description }));

  const latestEvidence = records
    .filter((r) => r.contractDigest === digest)
    .slice()
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
    .slice(0, MAX_RECENT_EVIDENCE)
    .map((r) => ({
      criterionId: r.criterionId,
      verifierId: r.verifierId,
      result: r.result,
      timestamp: r.timestamp,
      durationMs: r.durationMs,
    }));

  return {
    outcome: contract.outcome,
    mode: contract.mode,
    contractDigest: digest,
    constraints: contract.constraints,
    unprovenCriteria,
    latestEvidence,
    openApprovals,
  };
}
