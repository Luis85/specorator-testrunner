import { describe, expect, it } from "vitest";
import { matchStep } from "../src/vocabulary";

describe("matchStep", () => {
  it("matches a one-argument step and extracts the arg", () => {
    const m = matchStep('the user opens "/login"');
    expect(m).not.toBeNull();
    expect(m!.args).toEqual(["/login"]);
  });

  it("matches a two-argument step in order", () => {
    const m = matchStep('the user fills "label=Email" with "a@b.co"');
    expect(m).not.toBeNull();
    expect(m!.args).toEqual(["label=Email", "a@b.co"]);
  });

  it("matches assertion steps", () => {
    expect(matchStep('the page should show "Welcome"')).not.toBeNull();
    expect(matchStep('"role=alert" should be visible')).not.toBeNull();
    expect(matchStep('the url should contain "/dashboard"')).not.toBeNull();
  });

  it("returns null for unknown steps", () => {
    expect(matchStep("the user does something undefined")).toBeNull();
  });
});
