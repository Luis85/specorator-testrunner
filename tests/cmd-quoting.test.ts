import { describe, expect, it } from "vitest";
import { quoteForCmd } from "../src/infrastructure/runner/node-child-process-runner";

describe("quoteForCmd (Windows cmd.exe token quoting)", () => {
  it("wraps a token in double quotes so spaces keep their argv boundary", () => {
    expect(quoteForCmd("@smoke and not @wip")).toBe('"@smoke and not @wip"');
    expect(quoteForCmd("../Specifications/features/Price $5.feature")).toBe(
      '"../Specifications/features/Price $5.feature"',
    );
  });

  it("keeps cmd metacharacters literal inside the quotes", () => {
    // & | < > ^ ( ) are not interpreted by cmd inside double quotes.
    expect(quoteForCmd("../features/R&D.feature")).toBe('"../features/R&D.feature"');
  });

  it("doubles an embedded quote per cmd convention", () => {
    expect(quoteForCmd('a"b')).toBe('"a""b"');
  });
});
