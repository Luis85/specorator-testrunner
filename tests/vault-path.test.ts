import { describe, expect, it } from "vitest";
import { joinVaultPath, relativeVaultPath } from "../src/shared/utils/vault-path";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

describe("joinVaultPath", () => {
  it("joins segments with '/', collapsing duplicate and trailing separators", () => {
    expect(joinVaultPath("TestHub", "", "Evidence//2026/", "")).toBe("TestHub/Evidence/2026");
  });

  it("throws on an absolute segment (vault paths are vault-relative, ADR-0008)", () => {
    expect(() => joinVaultPath("/etc", "passwd")).toThrow(/absolute segment/);
    expect(() => joinVaultPath("TestHub", "\\windows")).toThrow(/absolute segment/);
  });

  it("throws on a traversal segment ('..' may never appear in a vault path)", () => {
    expect(() => joinVaultPath("TestHub", "..")).toThrow(/traversal segment/);
    expect(() => joinVaultPath("a/../b", "c")).toThrow(/traversal segment/);
    // A dotfile or '..' inside a NAME is fine — only path-level '..' is a bug.
    expect(joinVaultPath("notes", "..hidden..name")).toBe("notes/..hidden..name");
  });
});

describe("relativeVaultPath (pinned: unchanged by the joinVaultPath guard)", () => {
  it("still produces '..' hops between sibling folders", () => {
    expect(relativeVaultPath(vp("TestHub/.testrunner"), vp("TestHub/features"))).toBe(
      "../features",
    );
  });
});
