import { describe, expect, it } from "vitest";
import { MIN_SUBSTRING_SECRET_LEN, redactSecrets } from "../src/shared/logging/redact";

/**
 * Unit tests for the shared credential-redaction primitive (ADR-0019). One
 * implementation backs both the ConsoleLogger and the live Test Console stream,
 * so its semantics are pinned here once.
 */
describe("redactSecrets", () => {
  it("returns the text unchanged when the secret set is empty (hot-path short-circuit)", () => {
    expect(redactSecrets("anything at all", new Set())).toBe("anything at all");
  });

  it("redacts a value that EXACTLY equals a known secret, regardless of length", () => {
    // Whole-value match applies at any length, even below the substring gate.
    expect(redactSecrets("ab", new Set(["ab"]))).toBe("***");
    expect(redactSecrets("super-secret-token", new Set(["super-secret-token"]))).toBe("***");
  });

  it("substring-scrubs a long secret embedded inside a larger value", () => {
    expect(redactSecrets("login failed: super-secret (401)", new Set(["super-secret"]))).toBe(
      "login failed: *** (401)",
    );
  });

  it("scrubs EVERY occurrence of an embedded long secret", () => {
    expect(redactSecrets("longsecret then longsecret", new Set(["longsecret"]))).toBe(
      "*** then ***",
    );
  });

  it("does NOT substring-scrub a short secret (whole-value match only)", () => {
    // "node" (< MIN_SUBSTRING_SECRET_LEN) must not mangle unrelated diagnostics.
    expect("node".length).toBeLessThan(MIN_SUBSTRING_SECRET_LEN);
    expect(redactSecrets("running on node v22", new Set(["node"]))).toBe("running on node v22");
    // …but still redacts it as a whole value.
    expect(redactSecrets("node", new Set(["node"]))).toBe("***");
  });

  it("applies all secrets in the set", () => {
    expect(redactSecrets("user=alice pass=hunter2pw", new Set(["alice123", "hunter2pw"]))).toBe(
      "user=alice pass=***",
    );
  });
});
