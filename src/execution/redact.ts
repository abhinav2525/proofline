/**
 * Best-effort redaction of obvious secrets from captured verifier output before
 * it is written to the evidence log. This is a safety net, not a guarantee: the
 * strongest protection is that Proofline gives children a minimal environment,
 * so most secrets never reach the child in the first place. Redaction covers the
 * common cases where a tool echoes a credential it was given explicitly.
 */
const PATTERNS: Array<[RegExp, string]> = [
  // PEM private key blocks
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "«redacted-private-key»",
  ],
  // Authorization: Bearer <token> — run before the generic key:value rule so the
  // token itself is redacted, not just the word "Bearer".
  [/\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 «redacted»"],
  // AWS access key ids
  [/\bAKIA[0-9A-Z]{16}\b/g, "«redacted-aws-key»"],
  // key: value / key=value for sensitive-looking keys
  [
    /\b(api[_-]?key|secret|token|password|passwd|access[_-]?key|private[_-]?key|authorization)\b(\s*[:=]\s*)(\S+)/gi,
    "$1$2«redacted»",
  ],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
