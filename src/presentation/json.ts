/**
 * JSON output helpers. In `--json` mode, stdout must contain exactly one JSON
 * value and nothing else — no logs, no prompts, no ANSI. Diagnostics always go
 * to stderr. This keeps the machine-readable contract stable for scripting and
 * for the future read-only MCP adapter.
 */
export function toJsonLine(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
