import * as clack from "@clack/prompts";
import { access } from "node:fs/promises";
import {
  validateContract,
  type Contract,
  type ValidationResult,
} from "../domain/contract-schema.ts";
import { contractDigest } from "../domain/digest.ts";
import { saveContract } from "../storage/contract-store.ts";
import { ExitCode } from "../cli/exit-codes.ts";
import { renderIssues } from "../presentation/human.ts";
import type { CommandContext, CommandResult } from "../cli/command.ts";

/**
 * Build and validate a contract from a plain answers object. Pure and testable:
 * it injects the schema version and runs the full contract validation. Used by
 * both the interactive prompt flow and the non-interactive stdin flow.
 */
export function buildContractFromAnswers(answers: unknown): ValidationResult {
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
    return { ok: false, issues: ["answers must be a JSON object"] };
  }
  const candidate = { version: 1, ...(answers as Record<string, unknown>) };
  return validateContract(candidate);
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function readAllStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function finalize(
  ctx: CommandContext,
  result: ValidationResult,
): Promise<CommandResult> {
  if (!result.ok) {
    return {
      code: ExitCode.INVALID_CONTRACT,
      json: { ok: false, issues: result.issues },
      stderr: renderIssues("Generated contract is invalid:", result.issues),
    };
  }
  const digest = contractDigest(result.contract);
  await saveContract(ctx.paths, result.contract);
  return {
    code: ExitCode.OK,
    json: { ok: true, path: ctx.paths.contractPath, digest },
    human: `Wrote delivery contract to ${ctx.paths.contractPath}\n  digest: ${digest.slice(0, 12)}…`,
  };
}

const REFUSE_OVERWRITE: CommandResult = {
  code: ExitCode.USAGE,
  json: { ok: false, reason: "contract-exists" },
  stderr:
    "A contract already exists. Re-run with --force to replace it (this overwrites the current contract).",
};

/**
 * `brief`: author a delivery contract. With a TTY it prompts interactively; when
 * stdin is piped it reads a JSON answers document (used for automation/tests).
 * It never overwrites an existing contract unless --force is given.
 */
export async function runBrief(ctx: CommandContext): Promise<CommandResult> {
  if ((await exists(ctx.paths.contractPath)) && !ctx.cli.force) {
    return REFUSE_OVERWRITE;
  }

  const interactive = process.stdin.isTTY === true;
  const result = interactive
    ? await collectInteractive()
    : await collectFromStdin();

  if (result.kind === "aborted") {
    return {
      code: ExitCode.USAGE,
      json: { ok: false, reason: "aborted" },
      stderr: result.message,
    };
  }
  return finalize(ctx, buildContractFromAnswers(result.answers));
}

type Collected =
  | { kind: "answers"; answers: unknown }
  | { kind: "aborted"; message: string };

async function collectFromStdin(): Promise<Collected> {
  const text = (await readAllStdin()).trim();
  if (text.length === 0) {
    return { kind: "aborted", message: "brief aborted: no answers provided on stdin." };
  }
  try {
    return { kind: "answers", answers: JSON.parse(text) };
  } catch (e) {
    return {
      kind: "aborted",
      message: `brief aborted: stdin was not valid JSON (${e instanceof Error ? e.message : String(e)}).`,
    };
  }
}

const CANCELLED: Collected = { kind: "aborted", message: "brief cancelled." };

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const required = (label: string) => (v: string | undefined) =>
  (v ?? "").trim().length === 0 ? `${label} is required.` : undefined;
const idValidator = (v: string | undefined) =>
  ID_PATTERN.test(v ?? "") ? undefined : "Use a lowercase id (a-z, 0-9, . _ -).";

/** Interactive authoring via @clack/prompts. Returns a plain answers object. */
async function collectInteractive(): Promise<Collected> {
  clack.intro("proofline brief");

  const outcome = await clack.text({
    message: "What is the delivery outcome?",
    validate: required("Outcome"),
  });
  if (clack.isCancel(outcome)) return CANCELLED;

  const mode = await clack.select({
    message: "Delivery mode?",
    options: [
      { value: "strict", label: "strict — every criterion must be proven" },
      { value: "advisory", label: "advisory — report only, never gate" },
    ],
    initialValue: "strict",
  });
  if (clack.isCancel(mode)) return CANCELLED;

  const constraintsRaw = await clack.text({
    message: "Hard constraints (one per line, optional):",
    placeholder: "e.g. no network access",
  });
  if (clack.isCancel(constraintsRaw)) return CANCELLED;
  const constraints = String(constraintsRaw)
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const verifiers: Array<Contract["verifiers"][number]> = [];
  for (;;) {
    const add = await clack.confirm({
      message: verifiers.length === 0 ? "Add a verifier?" : "Add another verifier?",
      initialValue: verifiers.length === 0,
    });
    if (clack.isCancel(add)) return CANCELLED;
    if (!add) break;

    const id = await clack.text({
      message: "Verifier id:",
      validate: idValidator,
    });
    if (clack.isCancel(id)) return CANCELLED;

    const argvRaw = await clack.text({
      message: "Command arguments (whitespace-separated; no shell; never include credentials):",
      placeholder: "bun test",
      validate: required("A program"),
    });
    if (clack.isCancel(argvRaw)) return CANCELLED;
    const argv = String(argvRaw).trim().split(/\s+/);

    verifiers.push({ id: String(id), argv, cwd: ".", timeoutMs: 30_000 });
  }

  const criteria: Array<Record<string, unknown>> = [];
  for (;;) {
    const add = await clack.confirm({
      message: criteria.length === 0 ? "Add an acceptance criterion?" : "Add another criterion?",
      initialValue: criteria.length === 0,
    });
    if (clack.isCancel(add)) return CANCELLED;
    if (!add) break;

    const id = await clack.text({
      message: "Criterion id:",
      validate: idValidator,
    });
    if (clack.isCancel(id)) return CANCELLED;

    const description = await clack.text({
      message: "Criterion description:",
      validate: required("Description"),
    });
    if (clack.isCancel(description)) return CANCELLED;

    let chosen: string[] = [];
    if (verifiers.length > 0) {
      const selected = await clack.multiselect({
        message: "Which verifiers prove this criterion? (space to select, none = manual)",
        options: verifiers.map((v) => ({ value: v.id, label: v.id })),
        required: false,
      });
      if (clack.isCancel(selected)) return CANCELLED;
      chosen = selected as string[];
    }

    let requiresApproval = false;
    if (chosen.length === 0) {
      const ra = await clack.confirm({
        message: "No verifiers selected — require a manual approval instead?",
        initialValue: true,
      });
      if (clack.isCancel(ra)) return CANCELLED;
      requiresApproval = ra;
    }

    criteria.push({
      id: String(id),
      description: String(description),
      verifiers: chosen,
      requiresApproval,
    });
  }

  clack.outro("Contract drafted.");
  return {
    kind: "answers",
    answers: {
      outcome: String(outcome),
      mode: String(mode),
      constraints,
      criteria,
      verifiers,
      approvals: [],
    },
  };
}
