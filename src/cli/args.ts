import { parseArgs } from "node:util";
import path from "node:path";

/**
 * Argument parsing uses Node's built-in `util.parseArgs` — no third-party CLI
 * framework. The grammar is intentionally tiny:
 *
 *   proofline <command> [--json] [--root <dir>] [--force]
 *             [--criterion <id>]... [--verifier <id>]...
 *             [--by <name>] [--note <note>]
 */
export interface ParsedCli {
  command: string | undefined;
  positionals: string[];
  json: boolean;
  root: string;
  force: boolean;
  yes: boolean;
  help: boolean;
  version: boolean;
  criteria: string[];
  verifiers: string[];
  by: string | undefined;
  note: string | undefined;
}

export class ArgsError extends Error {
  override name = "ArgsError";
}

export function parseCli(argv: string[], cwd: string): ParsedCli {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: "boolean", default: false },
        root: { type: "string" },
        force: { type: "boolean", default: false },
        yes: { type: "boolean", short: "y", default: false },
        criterion: { type: "string", multiple: true },
        verifier: { type: "string", multiple: true },
        by: { type: "string" },
        note: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (e) {
    throw new ArgsError(e instanceof Error ? e.message : String(e));
  }

  const [command, ...positionals] = parsed.positionals;
  const rootOption = parsed.values.root;

  return {
    command,
    positionals,
    json: parsed.values.json ?? false,
    root: rootOption ? path.resolve(cwd, rootOption) : path.resolve(cwd),
    force: parsed.values.force ?? false,
    yes: parsed.values.yes ?? false,
    help: parsed.values.help ?? false,
    version: parsed.values.version ?? false,
    criteria: parsed.values.criterion ?? [],
    verifiers: parsed.values.verifier ?? [],
    by: parsed.values.by,
    note: parsed.values.note,
  };
}
