import { describe, expect, it } from "vitest";
import { DefaultCommandSafetyPolicy } from "../src/domain/policies/command-safety-policy";

const policy = new DefaultCommandSafetyPolicy();

describe("DefaultCommandSafetyPolicy", () => {
  it("allows the trusted default runner argv", () => {
    for (const args of [
      ["npm", "--version"],
      ["npm", "install"],
      ["npm", "ci"],
      ["npx", "playwright", "--version"],
      ["npx", "playwright", "install", "chromium"],
      ["npx", "playwright", "install", "--with-deps", "chromium"],
      ["node", "--version"],
      ["/opt/homebrew/bin/node", "--version"],
      ["node.exe", "--version"],
      ["npm", "run", "test"],
      ["npm", "run", "test:smoke"],
      ["npm", "run", "test:ci"],
    ]) {
      expect(policy.assertSafe(args).ok, args.join(" ")).toBe(true);
    }
  });

  it("restricts node to a --version probe, never code execution (ADR-0010)", () => {
    for (const args of [
      ["node", "-e", "process.exit(42)"],
      ["node", "--eval", "require('fs')"],
      ["node", "-p", "1+1"],
      ["node", "script.js"],
      ["node"],
    ]) {
      const result = policy.assertSafe(args);
      expect(result.ok, args.join(" ")).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("COMMAND_DISALLOWED");
    }
  });

  it("only lets npx run the bundled Playwright CLI (ADR-0010)", () => {
    for (const args of [
      ["npx", "some-malicious-package"],
      ["npx", "-y", "cowsay"],
      ["npx"],
    ]) {
      expect(policy.assertSafe(args).ok, args.join(" ")).toBe(false);
    }
  });

  it("rejects npm subcommands the runner never uses (ADR-0010)", () => {
    for (const args of [
      ["npm", "exec", "--", "rm"],
      ["npm", "run"],
      ["npm", "run", "test; rm -rf /"],
      ["npm"],
    ]) {
      const result = policy.assertSafe(args);
      expect(result.ok, args.join(" ")).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("COMMAND_DISALLOWED");
    }
  });

  it("rejects an empty argv or a blank program", () => {
    expect(policy.assertSafe([]).ok).toBe(false);
    expect(policy.assertSafe(["   "]).ok).toBe(false);
  });

  it("rejects a program that is not an allowed binary", () => {
    for (const args of [["rm", "-rf", "/"], ["sh", "-c", "echo hi"], ["dd"]]) {
      const result = policy.assertSafe(args);
      expect(result.ok, args.join(" ")).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("COMMAND_DISALLOWED");
    }
  });

  it("rejects an argument that smuggles a NUL or newline", () => {
    for (const args of [
      ["npm", "run", "test\nrm -rf /"],
      ["npm", "run", "test\rfoo"],
      ["npm", "run", "test\0foo"],
    ]) {
      const result = policy.assertSafe(args);
      expect(result.ok, JSON.stringify(args)).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("COMMAND_DISALLOWED");
    }
  });

  it("accepts shell metacharacters as literal args (no shell to interpret them, PR #7)", () => {
    // Under shell: false these are literal feature-path/tag args — $, &, |, ;,
    // backticks, spaces are NOT interpolated and must NOT be rejected.
    for (const args of [
      ["npm", "run", "test", "--", "../features/R&D.feature"],
      ["npm", "run", "test", "--", "../features/Price $5.feature"],
      ["npm", "run", "test", "--", "--tags", "@a && @b || @c"],
      ["npm", "run", "test", "--", "../features/back`tick.feature"],
    ]) {
      expect(policy.assertSafe(args).ok, args.join(" ")).toBe(true);
    }
  });
});
