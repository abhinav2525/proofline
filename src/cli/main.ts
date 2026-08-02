#!/usr/bin/env bun
import { VERSION } from "../version.ts";
import { ArgsError, parseCli } from "./args.ts";
import { contextFor, type CommandResult } from "./command.ts";
import { ExitCode } from "./exit-codes.ts";
import { HELP_TEXT } from "./help.ts";
import { toJsonLine } from "../presentation/json.ts";
import { runValidate } from "../commands/validate.ts";
import { runContext } from "../commands/context.ts";
import { runStatus } from "../commands/status.ts";
import { runInit } from "../commands/init.ts";
import { runBrief } from "../commands/brief.ts";
import { runVerify } from "../commands/verify.ts";
import { runApprove } from "../commands/approve.ts";
import type { CommandContext } from "./command.ts";

type Handler = (ctx: CommandContext) => Promise<CommandResult>;

const HANDLERS: Record<string, Handler> = {
  validate: runValidate,
  context: runContext,
  status: runStatus,
  init: runInit,
  brief: runBrief,
  verify: runVerify,
  approve: runApprove,
};

function write(stream: NodeJS.WriteStream, text: string): void {
  stream.write(text.endsWith("\n") ? text : `${text}\n`);
}

function emit(result: CommandResult, json: boolean): number {
  if (result.stderr) write(process.stderr, result.stderr);
  if (json) {
    if (result.json !== undefined) write(process.stdout, toJsonLine(result.json));
  } else if (result.human !== undefined) {
    write(process.stdout, result.human);
  }
  return result.code;
}

export async function main(argv: string[], cwd: string): Promise<number> {
  let cli;
  try {
    cli = parseCli(argv, cwd);
  } catch (e) {
    if (e instanceof ArgsError) {
      write(process.stderr, e.message);
      return ExitCode.USAGE;
    }
    throw e;
  }

  if (cli.version) {
    write(process.stdout, VERSION);
    return ExitCode.OK;
  }
  if (cli.help || cli.command === undefined) {
    write(process.stdout, HELP_TEXT);
    return ExitCode.OK;
  }

  const handler = HANDLERS[cli.command];
  if (!handler) {
    write(process.stderr, `Unknown command: ${cli.command}\n\n${HELP_TEXT}`);
    return ExitCode.USAGE;
  }

  try {
    const result = await handler(contextFor(cli));
    return emit(result, cli.json);
  } catch (e) {
    write(process.stderr, `Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    return ExitCode.RUNTIME;
  }
}

if (import.meta.main) {
  main(Bun.argv.slice(2), process.cwd()).then((code) => process.exit(code));
}
