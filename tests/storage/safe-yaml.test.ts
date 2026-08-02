import { describe, expect, test } from "bun:test";
import { parseSafeYaml, SafeYamlError } from "../../src/storage/safe-yaml.ts";

describe("parseSafeYaml", () => {
  test("parses a plain document to a JS value", () => {
    const value = parseSafeYaml("outcome: ship it\nmode: strict\n");
    expect(value).toEqual({ outcome: "ship it", mode: "strict" });
  });

  test("rejects multi-document input", () => {
    expect(() => parseSafeYaml("a: 1\n---\nb: 2\n")).toThrow(SafeYamlError);
  });

  test("rejects anchors and aliases", () => {
    expect(() => parseSafeYaml("base: &a 1\nref: *a\n")).toThrow(SafeYamlError);
  });

  test("rejects custom tags", () => {
    expect(() => parseSafeYaml("value: !Danger hello\n")).toThrow(SafeYamlError);
  });

  test("rejects input over the size cap", () => {
    const big = "x: " + "a".repeat(2_000_000) + "\n";
    expect(() => parseSafeYaml(big, { maxBytes: 1_000_000 })).toThrow(SafeYamlError);
  });

  test("rejects malformed YAML with a SafeYamlError", () => {
    expect(() => parseSafeYaml("a: [1, 2\n")).toThrow(SafeYamlError);
  });

  test("rejects an empty document", () => {
    expect(() => parseSafeYaml("\n")).toThrow(SafeYamlError);
  });
});
