import { describe, expect, it } from "vitest";
import { rowDigest } from "../src/domain/value-objects/scenario-reference";

describe("rowDigest (content-stable Outline row key, US-056)", () => {
  it("is deterministic for the same cells", () => {
    const cells: [string, string][] = [["role", "admin"], ["name", "Alice"]];
    expect(rowDigest(cells)).toBe(rowDigest(cells));
  });

  it("is independent of column order (sorted by header)", () => {
    expect(rowDigest([["role", "admin"], ["name", "Alice"]])).toBe(
      rowDigest([["name", "Alice"], ["role", "admin"]]),
    );
  });

  it("changes when a value changes", () => {
    expect(rowDigest([["role", "admin"]])).not.toBe(rowDigest([["role", "user"]]));
  });

  it("does not alias rows when values contain separators", () => {
    expect(rowDigest([["x", "a=b"]])).not.toBe(rowDigest([["x", "a"], ["", "b"]]));
  });

  it("returns a compact base36 string", () => {
    expect(rowDigest([["role", "admin"]])).toMatch(/^[0-9a-z]+$/);
  });
});
