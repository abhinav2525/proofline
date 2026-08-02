import { access, mkdir } from "node:fs/promises";
import { ExitCode } from "../cli/exit-codes.ts";
import { DIR_NAME } from "../storage/paths.ts";
import type { CommandContext, CommandResult } from "../cli/command.ts";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * `init`: create the project-local `.proofline/` directory. It is strictly
 * non-destructive — it will create the directory if missing but never writes,
 * modifies, or removes an existing contract. Authoring a contract is `brief`.
 */
export async function runInit(ctx: CommandContext): Promise<CommandResult> {
  const dirExisted = await exists(ctx.paths.dir);
  const contractExists = await exists(ctx.paths.contractPath);

  if (!dirExisted) {
    await mkdir(ctx.paths.dir, { recursive: true });
  }

  const created = !dirExisted;
  const nextStep = contractExists
    ? "A contract already exists. Use `proofline brief --force` to replace it."
    : "Run `proofline brief` to author your delivery contract.";

  const human = [
    created
      ? `Initialized ${DIR_NAME}/ at ${ctx.paths.dir}`
      : `${DIR_NAME}/ already present at ${ctx.paths.dir}`,
    nextStep,
  ].join("\n");

  return {
    code: ExitCode.OK,
    json: {
      ok: true,
      dir: ctx.paths.dir,
      created,
      contractExists,
    },
    human,
  };
}
