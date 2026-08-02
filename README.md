# Proofline

A private, local-first CLI that maintains one delivery contract per project,
runs only explicitly declared verification commands, records non-secret
evidence, and reports whether delivery criteria are proven.

> **Status:** v1, private and local only. No publishing, no remote service, no
> agent/hook/MCP integration. "Proofline" is a working name.

## Install (local)

Proofline is a Bun + TypeScript project. Run it from source or build a local
binary.

```bash
bun install --frozen-lockfile

# Run from source:
bun run src/cli/main.ts --help

# Or build a local macOS Apple Silicon executable:
bun run build
./dist/proofline --help
```

The build produces `dist/proofline` for `bun-darwin-arm64` only. It is **not**
signed, notarized, or published.

## Concepts

- **Delivery contract** — `.proofline/delivery.yaml`: one versioned document
  describing the `outcome`, `mode`, `constraints`, acceptance `criteria`,
  `verifiers`, and `approvals`.
- **Criterion** — a thing that must be true to deliver. It is proven by one or
  more verifiers and/or a manual approval.
- **Verifier** — a validated `argv` array (never a shell string) plus a
  project-relative `cwd` and a bounded `timeoutMs`.
- **Evidence** — `.proofline/evidence.json`: an append-only, non-secret record
  of each verifier run (result, timing, output digest, bounded redacted
  preview, and the contract digest it applied to).

### Criterion states (`status`)

| State      | Meaning                                                        |
|------------|----------------------------------------------------------------|
| `proven`   | Every requirement satisfied under the current contract digest. |
| `unproven` | No failing evidence, but proof is incomplete (a run is missing).|
| `failed`   | A referenced verifier's latest matching evidence did not pass. |
| `blocked`  | Requires an approval that has not been granted.                |

## Commands

```
proofline init       Create .proofline/ (never overwrites an existing contract)
proofline brief      Author a contract (interactive TTY, or JSON answers on stdin)
proofline validate   Check the contract is well-formed
proofline context    Compact, non-secret snapshot of remaining work
proofline status     Report each criterion's state
proofline verify     Run declared verifiers and record evidence
```

Global flags: `--json` (machine-readable stdout), `--root <dir>`,
`-h/--help`, `-v/--version`. `verify` accepts repeatable `--criterion <id>` and
`--verifier <id>` filters. `brief`/`init` accept `--force`.

### Example

```bash
proofline init
# author interactively, or pipe answers:
cat answers.json | proofline brief
proofline validate
proofline verify
proofline status
```

## Execution & security limits

- **argv only.** Verifiers are executed via `Bun.spawn` with a validated
  argument array. Proofline never invokes a shell, `Bun.$`, `sh -c`, `bash -c`,
  or `eval`. Running `verify` executes reviewed commands **with your own OS
  permissions** — review the contract before running it.
- **Minimal environment.** Children receive only an allowlisted subset of
  environment variables; parent secrets are not inherited, and the environment
  is never written to evidence.
- **Redacted, bounded evidence.** Output is captured up to a byte cap and passed
  through best-effort secret redaction; a digest of the full output is stored.
- **Root containment & atomic writes.** A verifier `cwd` may not escape the
  project root. All state is written atomically (temp file + fsync + rename).
- **Restricted YAML.** Contracts must be a single plain document — no multiple
  documents, anchors, aliases, or custom tags.

## Non-goals (v1)

- No web UI, API server, database, authentication, telemetry, or cloud sync.
- No agent orchestration, Claude Code hooks, MCP server, or Hermes plugin.
- No automatic commits, pushes, deployment, or delivery finalization. A passing
  verifier is evidence, never approval — that decision stays with a human.

## Exit codes

`0` ok · `1` not proven (strict `status`) · `2` usage · `3` no contract ·
`4` invalid contract · `5` a verifier did not pass · `6` runtime error.
