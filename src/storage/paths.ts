import path from "node:path";

/**
 * All Proofline state lives in a single project-local directory. Paths are
 * always derived from an explicit project root so nothing is resolved against
 * an ambient current-working-directory by accident.
 */
export const DIR_NAME = ".proofline";
export const CONTRACT_FILE = "delivery.yaml";
export const EVIDENCE_FILE = "evidence.json";

export interface ProoflinePaths {
  root: string;
  dir: string;
  contractPath: string;
  evidencePath: string;
}

export function prooflinePaths(root: string): ProoflinePaths {
  const absoluteRoot = path.resolve(root);
  const dir = path.join(absoluteRoot, DIR_NAME);
  return {
    root: absoluteRoot,
    dir,
    contractPath: path.join(dir, CONTRACT_FILE),
    evidencePath: path.join(dir, EVIDENCE_FILE),
  };
}
