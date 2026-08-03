# Proofline

**From intent to verified delivery.**

Proofline is a small, local-first CLI for keeping an AI-assisted software delivery agreement in the repository itself:

```text
intent → constraints → acceptance criteria → verification evidence → human approval
```

It does not write your application code, manage agents, deploy software, or replace Git. It makes the *definition of done* and the evidence for it explicit and reviewable.

## What it does

For each project, Proofline keeps:

- **a delivery contract** in `.proofline/delivery.yaml` — outcome, constraints, acceptance criteria, verifier commands, and required approvals;
- **verification evidence** in `.proofline/evidence.json` — bounded metadata about each verifier run;
- **a compact status** showing what is proven, failed, blocked, or still unproven.

A successful verifier is **evidence only**. It never automatically finalizes a delivery; human approval remains explicit.

## Requirements

- macOS on Apple Silicon for the current compiled binary target;
- [Bun](https://bun.sh/) for running from source or building the local binary.

Proofline is currently private, local-only software. There is no hosted service, account, telemetry, remote sync, or package release.

## Install and build

```bash
git clone git@github.com:abhinav2525/proofline.git
cd proofline
bun install --frozen-lockfile
bun run build

# Confirm the local binary works
./dist/proofline --help
```

The build creates `dist/proofline` for `bun-darwin-arm64`. It is not signed, notarized, or published.

To run directly from source during development:

```bash
bun run src/cli/main.ts --help
```

## Quick start

Use the binary from inside the project you want to track. In the examples below, replace `/path/to/proofline` with this repository's path.

```bash
cd /path/to/your-project
/path/to/proofline/dist/proofline init
/path/to/proofline/dist/proofline brief
```

`brief` opens an interactive prompt for the delivery outcome, constraints, verifier commands, and acceptance criteria. Then validate and verify the contract:

```bash
/path/to/proofline/dist/proofline validate
/path/to/proofline/dist/proofline context
/path/to/proofline/dist/proofline verify
/path/to/proofline/dist/proofline status
```

## A complete example

Suppose the goal is to add a feature that must pass unit tests, typecheck, and receive a human review.

Create an `answers.json` file in the target project:

```json
{
  "outcome": "Add the export feature without breaking existing behavior.",
  "mode": "strict",
  "constraints": [
    "Do not deploy or publish anything.",
    "Do not place credentials in verifier arguments."
  ],
  "verifiers": [
    {
      "id": "unit-tests",
      "description": "Run the unit test suite",
      "argv": ["bun", "test"],
      "cwd": ".",
      "timeoutMs": 120000
    },
    {
      "id": "typecheck",
      "description": "Run the TypeScript typecheck",
      "argv": ["bun", "run", "typecheck"],
      "cwd": ".",
      "timeoutMs": 60000
    }
  ],
  "criteria": [
    {
      "id": "tests-pass",
      "description": "All unit tests pass.",
      "verifiers": ["unit-tests"],
      "requiresApproval": false
    },
    {
      "id": "types-pass",
      "description": "The project typechecks without errors.",
      "verifiers": ["typecheck"],
      "requiresApproval": false
    },
    {
      "id": "human-review",
      "description": "The delivery has been reviewed and accepted by the owner.",
      "verifiers": [],
      "requiresApproval": true
    }
  ],
  "approvals": []
}
```

Create the contract from that file, then run it:

```bash
/path/to/proofline/dist/proofline init
cat answers.json | /path/to/proofline/dist/proofline brief --json
/path/to/proofline/dist/proofline validate
/path/to/proofline/dist/proofline verify
/path/to/proofline/dist/proofline status
```

In strict mode, `status` remains blocked until a required human approval is recorded:

```bash
/path/to/proofline/dist/proofline approve human-review \
  --by "Abhinav" \
  --note "Reviewed the export feature"

/path/to/proofline/dist/proofline status
```

`approve` runs **no verifiers** and does not make a delivery decision on its own. It records the human decision; the final `status` combines that approval with current verification evidence.

## Commands

| Command | Purpose |
|---|---|
| `proofline init` | Create `.proofline/`. Never overwrites an existing contract. |
| `proofline brief` | Author a contract interactively, or read JSON answers from standard input. |
| `proofline validate` | Validate the contract without running anything. |
| `proofline context` | Print a compact, non-secret view of remaining work. |
| `proofline verify` | Run declared verifiers and record non-secret evidence. |
| `proofline status` | Report whether each criterion is proven, failed, blocked, or unproven. |
| `proofline approve <criterion> --by <name>` | Record a required human approval. |

Useful options:

```text
--json                    machine-readable stdout
--root <dir>              target project root; defaults to the current directory
--criterion <id>          verify only one or more criteria; repeatable
--verifier <id>           verify only one or more verifiers; repeatable
--by <name>               required approver name for `approve`
--note <note>             optional approval note
--force                   allow `brief` to replace an existing contract
-h, --help                command help
-v, --version             version
```

## Reading status

| State | Meaning |
|---|---|
| `proven` | Every verifier and/or required approval is satisfied for the current contract. |
| `unproven` | No current failing evidence, but a required verifier has not run. |
| `failed` | The latest applicable verifier evidence failed. |
| `blocked` | A required human approval has not yet been recorded. |

`status` exits with code `0` when a strict contract is ready, and `1` when it is not ready. A passing `verify` can still leave `status` blocked or unproven.

## Safety model

Proofline treats declared verification as a security boundary:

- **argv only:** verifiers are executed with validated argument arrays through `Bun.spawn`; Proofline never invokes `Bun.$`, `sh -c`, `bash -c`, or `eval`;
- **project containment:** verifier working directories and state writes are checked against the project root, including symlink escape prevention;
- **timeouts:** each verifier has a bounded timeout; on the supported macOS target, the verifier process group is terminated on timeout;
- **minimal environment:** children receive only a small allowlisted environment, not the full parent environment;
- **non-secret evidence:** verifier output is never persisted. Evidence stores only structural metadata, output byte count, and an SHA-256 digest;
- **restricted YAML:** contracts reject multiple documents, anchors, aliases, custom tags, unknown fields, and invalid path shapes;
- **atomic state writes:** contract and evidence updates use temporary files, fsync, and rename.

> **Do not put credentials, tokens, passwords, or API keys in verifier arguments.** Proofline intentionally records verifier argv values in the contract and evidence so the check is reviewable. Use a local, user-controlled credential mechanism outside the contract when authentication is genuinely needed.

Running `verify` executes reviewed commands with your OS permissions. Read a contract before running it.

## Project files

```text
.proofline/
├── delivery.yaml     # contract: outcome, criteria, verifiers, approvals
└── evidence.json     # append-only verification evidence
```

Proofline does not automatically add these files to Git. Decide per project whether the contract and evidence should remain local or be versioned.

## Development

```bash
bun test            # full test suite
bun run typecheck   # TypeScript typecheck
bun run build       # build local macOS Apple Silicon binary
./dist/proofline --help
```

## Non-goals in v1

- no web UI, API server, database, accounts, telemetry, or cloud sync;
- no agent orchestration, Claude Code hooks, MCP server, or Hermes plugin;
- no automatic Git commits, pushes, deployment, publishing, or delivery finalization.

## Exit codes

```text
0  success
1  strict status is not ready
2  usage error
3  no contract found
4  invalid contract
5  one or more verifiers did not pass
6  runtime error
```
