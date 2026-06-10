import { describe, expect, it } from "vitest";
import {
  projectSuiteRows,
  scenarioCountCell,
  tagExpressionPreview,
} from "../src/presentation/views/suite-rows";
import type { TestSuite } from "../src/domain/entities/suite";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { appError } from "../src/shared/errors/errors";
import { err, ok } from "../src/shared/result/result";

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

describe("scenarioCountCell (Wave F)", () => {
  it("shows the matched count with a pluralised aria-label", () => {
    expect(scenarioCountCell(ok(12))).toEqual({
      text: "12",
      status: null,
      tooltip: null,
      ariaLabel: "12 scenarios match",
    });
    expect(scenarioCountCell(ok(1)).ariaLabel).toBe("1 scenario matches");
  });

  it("accents a zero count as a warning with an explanatory tooltip", () => {
    expect(scenarioCountCell(ok(0))).toEqual({
      text: "0",
      status: "warning",
      tooltip: "No scenarios match this Tag Expression.",
      ariaLabel: "0 scenarios match",
    });
  });

  it("shows an em dash naming the parse error for a malformed Tag Expression", () => {
    const cell = scenarioCountCell(err(appError("VALIDATION_FAILED", "Expected a tag.")));
    expect(cell.text).toBe("—");
    expect(cell.status).toBeNull();
    expect(cell.tooltip).toBe("Expected a tag.");
    expect(cell.ariaLabel).toContain("Expected a tag.");
  });
});

describe("tagExpressionPreview (Wave F)", () => {
  it("phrases the matched count, singular and plural", () => {
    expect(tagExpressionPreview(ok(3))).toEqual({ text: "Matches 3 scenarios.", status: null });
    expect(tagExpressionPreview(ok(1))).toEqual({ text: "Matches 1 scenario.", status: null });
  });

  it("warns (non-blocking) when nothing matches", () => {
    expect(tagExpressionPreview(ok(0))).toEqual({
      text: "No scenarios match this Tag Expression.",
      status: "warning",
    });
  });

  it("surfaces the parse error verbatim", () => {
    expect(tagExpressionPreview(err(appError("VALIDATION_FAILED", "Unclosed (.")))).toEqual({
      text: "Unclosed (.",
      status: "error",
    });
  });
});
