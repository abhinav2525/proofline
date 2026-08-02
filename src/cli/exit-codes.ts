/**
 * Stable process exit codes. These are part of the CLI contract and are safe to
 * script against. Note: NOT_PROVEN and VERIFY_FAILED report criterion/check
 * state only — they never represent a finalization of delivery.
 */
export const ExitCode = {
  OK: 0,
  NOT_PROVEN: 1, // status: at least one criterion is not proven (strict mode)
  USAGE: 2, // bad command or flags
  NO_CONTRACT: 3, // no contract found where one was required
  INVALID_CONTRACT: 4, // contract present but failed validation
  VERIFY_FAILED: 5, // one or more verifiers did not pass
  RUNTIME: 6, // unexpected I/O or internal error
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
