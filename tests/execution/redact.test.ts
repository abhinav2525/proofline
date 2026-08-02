import { describe, expect, test } from "bun:test";
import { redactSecrets } from "../../src/execution/redact.ts";

describe("redactSecrets", () => {
  test("redacts key=value secrets", () => {
    const out = redactSecrets("API_KEY=sk-abc123 done");
    expect(out).not.toContain("sk-abc123");
    expect(out).toContain("«redacted»");
  });

  test("redacts bearer tokens and aws keys", () => {
    expect(redactSecrets("Authorization: Bearer abcdef123456")).not.toContain(
      "abcdef123456",
    );
    expect(redactSecrets("id AKIAIOSFODNN7EXAMPLE here")).not.toContain(
      "AKIAIOSFODNN7EXAMPLE",
    );
  });

  test("leaves ordinary output untouched", () => {
    const text = "3 tests passed in 12ms";
    expect(redactSecrets(text)).toBe(text);
  });
});
