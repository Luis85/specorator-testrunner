import { describe, expect, it } from "vitest";
import { Runner, interpolate } from "../src/runner/runner";
import type { TestCase } from "../src/types";
import { FakeDriver } from "./fake-driver";

function testCase(gherkin: string): TestCase {
  return {
    id: "TC-1",
    title: "t",
    suite: "s",
    tags: [],
    status: "ready",
    gherkin,
    path: "TC-1.md",
  };
}

describe("interpolate", () => {
  it("resolves known vars and leaves unknown intact", () => {
    expect(interpolate('open "{{path}}"', { path: "/x" })).toBe('open "/x"');
    expect(interpolate("{{missing}}", {})).toBe("{{missing}}");
  });
});

describe("Runner", () => {
  it("passes a scenario when all steps and assertions hold", async () => {
    const driver = new FakeDriver();
    driver.visible.add("text=Welcome");
    const tc = testCase(`Feature: F
  Scenario: ok
    Given the user opens "/login"
    When the user clicks "role=button[Sign in]"
    Then the page should show "Welcome"
`);
    const result = await new Runner(driver).runCase(tc, { env: "test" });
    expect(result.success).toBe(true);
    expect(result.totals.passed).toBe(1);
    expect(driver.calls).toContain("open /login");
  });

  it("fails the scenario and skips later steps on a failed assertion", async () => {
    const driver = new FakeDriver(); // "Welcome" NOT visible -> assertion fails
    const tc = testCase(`Feature: F
  Scenario: bad
    Given the user opens "/login"
    Then the page should show "Welcome"
    And the user clicks "role=button[Next]"
`);
    const result = await new Runner(driver).runCase(tc, { env: "test" });
    expect(result.success).toBe(false);
    expect(result.totals.failed).toBe(1);
    const sc = result.scenarios[0];
    expect(sc.steps.map((s) => s.status)).toEqual(["passed", "failed", "skipped"]);
  });

  it("marks unmatched steps as undefined", async () => {
    const tc = testCase(`Feature: F
  Scenario: unknown
    Given the user does a barrel roll
`);
    const result = await new Runner(new FakeDriver()).runCase(tc, { env: "test" });
    expect(result.scenarios[0].steps[0].status).toBe("undefined");
  });
});
