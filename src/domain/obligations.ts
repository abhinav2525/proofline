import type { Contract, Criterion } from "./contract-schema.ts";
import type { EvidenceRecord } from "./evidence-schema.ts";

/**
 * Derive the current state of every acceptance criterion from the contract and
 * the evidence log. This is the heart of `status`. States, in precedence order:
 *
 *   failed   - a referenced verifier's latest matching evidence did not pass
 *   blocked  - the criterion requires an approval that has not been granted
 *   unproven - no failing evidence, but proof is incomplete (missing runs)
 *   proven   - every requirement is satisfied under the current contract digest
 *
 * A `proven` status is evidence about criteria only. It is never, by itself,
 * a finalization of delivery — that decision stays with a human.
 */
export type CriterionState = "proven" | "unproven" | "failed" | "blocked";

export interface VerifierStatus {
  verifierId: string;
  latest: EvidenceRecord | null;
}

export interface ObligationStatus {
  id: string;
  description: string;
  state: CriterionState;
  requiresApproval: boolean;
  approvalGranted: boolean;
  reasons: string[];
  verifiers: VerifierStatus[];
  latestEvidence: EvidenceRecord | null;
}

function latestByTimestamp(records: EvidenceRecord[]): EvidenceRecord | null {
  let best: EvidenceRecord | null = null;
  for (const r of records) {
    if (best === null || r.timestamp > best.timestamp) best = r;
  }
  return best;
}

function statusForCriterion(
  criterion: Criterion,
  approvalGranted: boolean,
  relevant: EvidenceRecord[],
): ObligationStatus {
  const reasons: string[] = [];
  const verifiers: VerifierStatus[] = criterion.verifiers.map((verifierId) => ({
    verifierId,
    latest: latestByTimestamp(relevant.filter((r) => r.verifierId === verifierId)),
  }));

  const anyFailed = verifiers.some(
    (v) => v.latest !== null && v.latest.result !== "passed",
  );
  const missing = verifiers.filter((v) => v.latest === null);
  const allPass =
    verifiers.length > 0 &&
    verifiers.every((v) => v.latest !== null && v.latest.result === "passed");

  let state: CriterionState;
  if (anyFailed) {
    state = "failed";
    for (const v of verifiers) {
      if (v.latest && v.latest.result !== "passed") {
        reasons.push(`verifier '${v.verifierId}' ${v.latest.result}`);
      }
    }
  } else if (criterion.requiresApproval && !approvalGranted) {
    state = "blocked";
    reasons.push("awaiting approval");
  } else if (criterion.verifiers.length === 0) {
    // Manual criterion whose approval has been granted.
    state = "proven";
  } else if (allPass) {
    state = "proven";
  } else {
    state = "unproven";
    for (const v of missing) reasons.push(`verifier '${v.verifierId}' not yet run`);
  }

  return {
    id: criterion.id,
    description: criterion.description,
    state,
    requiresApproval: criterion.requiresApproval,
    approvalGranted,
    reasons,
    verifiers,
    latestEvidence: latestByTimestamp(relevant),
  };
}

export function computeObligations(
  contract: Contract,
  records: EvidenceRecord[],
  currentDigest: string,
): ObligationStatus[] {
  const current = records.filter((r) => r.contractDigest === currentDigest);
  const approvedCriteria = new Set(contract.approvals.map((a) => a.criterion));

  return contract.criteria.map((criterion) =>
    statusForCriterion(
      criterion,
      approvedCriteria.has(criterion.id),
      current.filter((r) => r.criterionId === criterion.id),
    ),
  );
}

/** True when every criterion is proven under the current digest. */
export function allProven(statuses: ObligationStatus[]): boolean {
  return statuses.length > 0 && statuses.every((s) => s.state === "proven");
}
