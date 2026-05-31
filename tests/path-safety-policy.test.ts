import { describe, expect, it } from "vitest";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";

const policy = new DefaultPathSafetyPolicy();

describe("DefaultPathSafetyPolicy", () => {
  it("accepts relative vault paths, including hidden folders", () => {
    for (const path of ["Test Hub", "Specifications/features", ".testrunner", ".github/workflows"]) {
      expect(policy.validate(path).ok, path).toBe(true);
    }
  });

  it("rejects empty paths", () => {
    expect(policy.validate("").ok).toBe(false);
    expect(policy.validate("   ").ok).toBe(false);
  });

  it("rejects absolute paths (POSIX and Windows)", () => {
    expect(policy.validate("/etc/passwd").ok).toBe(false);
    expect(policy.validate("C:\\Windows").ok).toBe(false);
  });

  it("rejects paths that traverse upward", () => {
    expect(policy.validate("../escape").ok).toBe(false);
    expect(policy.validate("Test Hub/../../etc").ok).toBe(false);
  });

  it("does not reject '..' embedded in a legitimate segment", () => {
    expect(policy.validate("my..notes").ok).toBe(true);
  });

  it("returns a PATH_UNSAFE error code", () => {
    const result = policy.validate("../x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PATH_UNSAFE");
  });
});
