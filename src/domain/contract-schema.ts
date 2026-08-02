import { z } from "zod";
import { isSafeRelativePath } from "./paths-safety.ts";

/**
 * The delivery contract is the single source of truth for what "done" means on
 * a project. It is intentionally small, strict, and versioned. Unknown fields
 * are rejected so a malformed or attacker-supplied document cannot smuggle in
 * behavior the schema does not describe.
 */

export const MAX_TIMEOUT_MS = 600_000; // 10 minutes: a hard ceiling per verifier.
export const DEFAULT_TIMEOUT_MS = 30_000;

const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9._-]*$/,
    "id must be lowercase alphanumeric with '.', '_' or '-' separators",
  );

const relativeCwdSchema = z
  .string()
  .max(256)
  .refine(isSafeRelativePath, {
    message: "cwd must be a project-relative path that does not escape the root",
  });

const verifierSchema = z.strictObject({
  id: idSchema,
  description: z.string().min(1).max(200).optional(),
  argv: z
    .array(z.string().min(1, "argv entries must be non-empty"))
    .min(1, "argv must contain at least the program to run")
    .max(64),
  cwd: relativeCwdSchema.default("."),
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS),
});

const criterionSchema = z.strictObject({
  id: idSchema,
  description: z.string().min(1).max(500),
  verifiers: z.array(idSchema).max(64).default([]),
  requiresApproval: z.boolean().default(false),
});

const approvalSchema = z.strictObject({
  criterion: idSchema,
  by: z.string().min(1).max(120),
  note: z.string().max(500).optional(),
});

export const contractSchema = z
  .strictObject({
    version: z.literal(1),
    outcome: z.string().min(1).max(1000),
    mode: z.enum(["strict", "advisory"]),
    constraints: z.array(z.string().min(1).max(500)).max(64).default([]),
    criteria: z.array(criterionSchema).min(1).max(128),
    verifiers: z.array(verifierSchema).max(128).default([]),
    approvals: z.array(approvalSchema).max(128).default([]),
  })
  .superRefine((contract, ctx) => {
    const verifierIds = new Set<string>();
    for (const [i, v] of contract.verifiers.entries()) {
      if (verifierIds.has(v.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate verifier id: ${v.id}`,
          path: ["verifiers", i, "id"],
        });
      }
      verifierIds.add(v.id);
    }

    const criterionIds = new Set<string>();
    for (const [i, c] of contract.criteria.entries()) {
      if (criterionIds.has(c.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate criterion id: ${c.id}`,
          path: ["criteria", i, "id"],
        });
      }
      criterionIds.add(c.id);

      if (c.verifiers.length === 0 && !c.requiresApproval) {
        ctx.addIssue({
          code: "custom",
          message: `criterion '${c.id}' must reference a verifier or set requiresApproval`,
          path: ["criteria", i],
        });
      }

      for (const [j, ref] of c.verifiers.entries()) {
        if (!verifierIds.has(ref)) {
          ctx.addIssue({
            code: "custom",
            message: `criterion '${c.id}' references unknown verifier: ${ref}`,
            path: ["criteria", i, "verifiers", j],
          });
        }
      }
    }

    for (const [i, a] of contract.approvals.entries()) {
      if (!criterionIds.has(a.criterion)) {
        ctx.addIssue({
          code: "custom",
          message: `approval references unknown criterion: ${a.criterion}`,
          path: ["approvals", i, "criterion"],
        });
      }
    }
  });

export type Contract = z.infer<typeof contractSchema>;
export type Verifier = Contract["verifiers"][number];
export type Criterion = Contract["criteria"][number];
export type Approval = Contract["approvals"][number];

export type ValidationResult =
  | { ok: true; contract: Contract }
  | { ok: false; issues: string[] };

/** Format a Zod issue path like `verifiers.0.argv.1` for human diagnostics. */
function formatPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "(root)";
  return path.map((p) => String(p)).join(".");
}

export function validateContract(data: unknown): ValidationResult {
  const parsed = contractSchema.safeParse(data);
  if (parsed.success) return { ok: true, contract: parsed.data };
  const issues = parsed.error.issues.map(
    (issue) => `${formatPath(issue.path)}: ${issue.message}`,
  );
  return { ok: false, issues };
}
