import { describe, expect, it } from "vitest";
import { DefaultCommandSafetyPolicy } from "../src/domain/policies/command-safety-policy";

const policy = new DefaultCommandSafetyPolicy();

describe("DefaultCommandSafetyPolicy", () => {
  it("allows the trusted default runner commands", () => {
    for (const command of [
      "npm install",
      "npm ci",
      "npx playwright install chromium",
      "node --version",
      "npm run test:smoke",
    ]) {
      expect(policy.assertSafe(command).ok, command).toBe(true);
    }
  });

  it("rejects empty commands", () => {
    expect(policy.assertSafe("   ").ok).toBe(false);
  });

  it("rejects shell chaining and redirection", () => {
    for (const command of [
      "npm install && rm -rf /",
      "npm install; echo hi",
      "npm install | sh",
      "npm install > out.txt",
      "echo `whoami`",
      "echo $(whoami)",
    ]) {
      const result = policy.assertSafe(command);
      expect(result.ok, command).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("COMMAND_DISALLOWED");
    }
  });

  it("rejects destructive tokens", () => {
    expect(policy.assertSafe("rm -rf node_modules").ok).toBe(false);
    expect(policy.assertSafe("dd if=/dev/zero of=/dev/sda").ok).toBe(false);
  });
});
