import { describe, expect, it } from "vitest";
import {
  baseUrlProblem,
  isPlainRecord,
  nodeExecutableProblem,
  repairBrowsers,
} from "../src/application/services/settings-field-rules";

describe("isPlainRecord", () => {
  it("accepts a plain object", () => {
    expect(isPlainRecord({})).toBe(true);
    expect(isPlainRecord({ a: 1 })).toBe(true);
  });

  it("rejects null, arrays, and scalars", () => {
    expect(isPlainRecord(null)).toBe(false);
    expect(isPlainRecord([])).toBe(false);
    expect(isPlainRecord("x")).toBe(false);
    expect(isPlainRecord(3)).toBe(false);
  });
});

describe("baseUrlProblem", () => {
  it("accepts http, https, and file URLs", () => {
    expect(baseUrlProblem("https://staging.example.com")).toBeUndefined();
    expect(baseUrlProblem("http://localhost:3000")).toBeUndefined();
    expect(baseUrlProblem("file:///tmp/fixture.html")).toBeUndefined();
  });

  it("treats empty/whitespace as acceptable here (warning-level elsewhere)", () => {
    expect(baseUrlProblem("")).toBeUndefined();
    expect(baseUrlProblem("   ")).toBeUndefined();
  });

  it("rejects a non-string", () => {
    expect(baseUrlProblem(42 as unknown as string)).toBe("is not a string");
  });

  it("rejects control characters (newline smuggling)", () => {
    expect(baseUrlProblem("https://x\n.example.com")).toBe("contains a control character");
  });

  it("rejects an unparseable URL", () => {
    expect(baseUrlProblem("not a url")).toMatch(/is not a parseable URL/);
  });

  it("rejects an unsupported protocol", () => {
    expect(baseUrlProblem("ftp://example.com")).toMatch(/unsupported protocol "ftp:"/);
  });
});

describe("nodeExecutableProblem", () => {
  it("accepts a bare command name", () => {
    expect(nodeExecutableProblem("node")).toBeUndefined();
  });

  it("accepts absolute paths (POSIX, Windows drive, UNC)", () => {
    expect(nodeExecutableProblem("/usr/bin/node")).toBeUndefined();
    expect(nodeExecutableProblem("C:\\nodejs\\node.exe")).toBeUndefined();
    expect(nodeExecutableProblem("\\\\server\\tools\\node.exe")).toBeUndefined();
  });

  it("rejects a non-string", () => {
    expect(nodeExecutableProblem(1 as unknown as string)).toBe("is not a string");
  });

  it("rejects control characters", () => {
    expect(nodeExecutableProblem("no\nde")).toBe("contains a control character");
  });

  it("rejects a .. traversal segment", () => {
    expect(nodeExecutableProblem("../evil/node")).toMatch(/traversal/);
  });

  it("rejects a relative path with separators", () => {
    expect(nodeExecutableProblem("evil/node")).toMatch(/relative path/);
  });
});

describe("repairBrowsers", () => {
  it("keeps a valid set unchanged", () => {
    expect(repairBrowsers(["chromium", "firefox"])).toEqual({
      browsers: ["chromium", "firefox"],
      repaired: false,
    });
  });

  it("drops invalid and duplicate entries, flagging repaired", () => {
    expect(repairBrowsers(["chromium", "chromium", "netscape"])).toEqual({
      browsers: ["chromium"],
      repaired: true,
    });
  });

  it("falls back to chromium for an empty or non-array value", () => {
    expect(repairBrowsers([])).toEqual({ browsers: ["chromium"], repaired: true });
    expect(repairBrowsers("nope")).toEqual({ browsers: ["chromium"], repaired: true });
    expect(repairBrowsers(null)).toEqual({ browsers: ["chromium"], repaired: true });
  });
});
