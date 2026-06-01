import { describe, expect, it } from "vitest";
import { projectSuiteRows } from "../src/presentation/views/suite-rows";
import type { TestSuite } from "../src/domain/entities/suite";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

const suite = (over: Partial<TestSuite>): TestSuite => ({
  id: "smoke",
  name: "Smoke Suite",
  description: "Critical path.",
  tagExpression: "@smoke",
  path: vp("Test Suites/Smoke Suite.md"),
  ...over,
});

describe("projectSuiteRows", () => {
  it("projects the columns the suites panel displays", () => {
    const rows = projectSuiteRows([
      suite({ id: "smoke", name: "Smoke Suite", tagExpression: "@smoke and not @wip" }),
    ]);
    expect(rows).toEqual([
      {
        id: "smoke",
        name: "Smoke Suite",
        tagExpression: "@smoke and not @wip",
        path: vp("Test Suites/Smoke Suite.md"),
      },
    ]);
  });

  it("preserves input order", () => {
    const rows = projectSuiteRows([suite({ id: "regression" }), suite({ id: "smoke" })]);
    expect(rows.map((r) => r.id)).toEqual(["regression", "smoke"]);
  });
});
