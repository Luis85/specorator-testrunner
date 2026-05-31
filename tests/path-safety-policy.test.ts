import { describe, expect, it } from "vitest";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
// The policy is the primitive the smart constructor wraps; these tests feed it
// deliberately-hostile raw strings, branded with `vp` only to satisfy the typed
// `VaultPath` parameter (the cast performs no validation — the policy does).
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

const policy = new DefaultPathSafetyPolicy();

describe("DefaultPathSafetyPolicy", () => {
  it("accepts relative vault paths, including hidden folders", () => {
    for (const path of [
      "Test Hub",
      "Specifications/features",
      ".testrunner",
      ".github/workflows",
    ]) {
      expect(policy.validate(vp(path)).ok, path).toBe(true);
    }
  });

  it("rejects empty paths", () => {
    expect(policy.validate(vp("")).ok).toBe(false);
    expect(policy.validate(vp("   ")).ok).toBe(false);
  });

  it("returns a Result (does not throw) for a non-string value (review P2)", () => {
    // A corrupt data.json can hand a number where a path string belongs; the
    // policy must guard the type before any string method.
    expect(policy.validate(42 as unknown as string).ok).toBe(false);
    expect(policy.validate(null as unknown as string).ok).toBe(false);
    expect(policy.validate(undefined as unknown as string).ok).toBe(false);
  });

  it("rejects absolute paths (POSIX and Windows)", () => {
    expect(policy.validate(vp("/etc/passwd")).ok).toBe(false);
    expect(policy.validate(vp("C:\\Windows")).ok).toBe(false);
  });

  it("rejects paths that traverse upward", () => {
    expect(policy.validate(vp("../escape")).ok).toBe(false);
    expect(policy.validate(vp("Test Hub/../../etc")).ok).toBe(false);
  });

  it("does not reject '..' embedded in a legitimate segment", () => {
    expect(policy.validate(vp("my..notes")).ok).toBe(true);
  });

  it("returns a PATH_UNSAFE error code", () => {
    const result = policy.validate(vp("../x"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PATH_UNSAFE");
  });

  it("rejects the template-injection RCE payload reaching the cucumber.mjs glob (P0-1)", () => {
    // A crafted featureFilesPath that would break out of the JS string literal
    // and execute attacker code when Node loads the generated cucumber.mjs.
    const payload = 'features"]};import("node:child_process").execSync("calc");//';
    const result = policy.validate(vp(payload));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PATH_UNSAFE");
  });

  it("rejects JS/shell metacharacters and control characters in paths (P0-1)", () => {
    for (const path of ['a"b', "a'b", "a`b", "a$b", "a{b}", "a\\b", "a\nb", "a\tb", "a\u0000b"]) {
      expect(policy.validate(vp(path)).ok, JSON.stringify(path)).toBe(false);
    }
  });

  it("accepts non-English (Unicode) vault folder names (M2)", () => {
    // An ASCII-only allowlist would reject these and silently reset the user's
    // config to defaults; the denylist allows them while still blocking metachars.
    for (const path of ["Especificações", "テスト/features", "Spécifications", "Müll"]) {
      expect(policy.validate(vp(path)).ok, path).toBe(true);
    }
  });
});
