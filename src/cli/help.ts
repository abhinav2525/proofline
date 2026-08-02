export const HELP_TEXT = `proofline — local-first delivery-contract CLI

USAGE
  proofline <command> [options]

COMMANDS
  init        Create .proofline/ for this project (never overwrites a contract)
  brief       Interactively author a delivery contract
  validate    Check that the contract is well-formed
  context     Show the compact snapshot of remaining work (non-secret)
  status      Report whether each acceptance criterion is proven
  verify      Run declared verifiers and record non-secret evidence
  approve     Record a human approval for a criterion that requires one

OPTIONS
  --json             Emit machine-readable JSON on stdout
  --root <dir>       Project root (default: current directory)
  --criterion <id>   (verify) Limit to criteria; repeatable
  --verifier <id>    (verify) Limit to verifiers; repeatable
  --by <name>        (approve) Person granting the approval (required)
  --note <note>      (approve) Optional note recorded with the approval
  --force            (init) Re-create supporting files without touching a contract
  -y, --yes          Assume yes for non-destructive confirmations
  -h, --help         Show this help
  -v, --version      Show version

Verifiers are argv arrays only; Proofline never runs them through a shell.
A passing verifier is evidence for a criterion — never a finalization of delivery.
Approval is a human decision recorded by \`approve\`; it does not finalize delivery.`;
