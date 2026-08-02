# CLAUDE.md — Proofline

Local-first delivery-contract CLI. Bun + TypeScript. One active contract per
project at `.proofline/delivery.yaml`; non-secret evidence at
`.proofline/evidence.json`.

## Safety invariants (do not violate)

- **No shell for verifiers.** Verifiers are validated `argv` string arrays run
  via `Bun.spawn`. Never use `Bun.$`, `sh -c`, `bash -c`, `eval`, or shell
  strings for contract verifiers.
- **No secret reads or logging.** Do not read `.env`/secrets/credentials.
  Children get a minimal allowlisted environment
  (`src/execution/verifier-runner.ts`); parent env is never inherited wholesale
  and is never written to evidence. Output previews are redacted
  (`src/execution/redact.ts`).
- **No automatic finalization.** A passing verifier is evidence for a criterion,
  never a finalization of delivery. `verify` records; `status` reports. A
  human owns the delivery decision.
- **Root containment + atomic writes.** Verifier `cwd` must stay within the
  project root (`src/domain/paths-safety.ts`). All state writes go through
  `src/storage/atomic-write.ts` (temp file + fsync + rename).
- **Bounded everything.** Enforce size, timeout, and output caps. Restricted
  YAML profile rejects multi-document input, anchors, aliases, and custom tags
  (`src/storage/safe-yaml.ts`).
- **No scope expansion.** No hooks, MCP, Hermes plugin, web/server/database, or
  remote/publish. Runtime deps limited to `@clack/prompts`, `yaml`, `zod`.

## Layout

- `src/domain/` — pure model: contract/evidence schemas, obligations, digest,
  context pack, path safety.
- `src/storage/` — paths, safe YAML, atomic write, contract/evidence stores.
- `src/execution/` — verifier runner and redaction (only place code executes).
- `src/cli/` + `src/commands/` — arg parsing, dispatch, and the six commands.
- `src/presentation/` — human and JSON rendering.

## Conventions

- TDD: a focused failing test precedes any production behavior change.
- `--json` mode: stdout is exactly one JSON value; diagnostics go to stderr.
- Version lives in `src/version.ts` (imported from `package.json`).

## Commands

```
bun test            # full suite
bun run typecheck   # tsc --noEmit
bun run build       # local macOS arm64 binary -> dist/proofline
```
