import { describe, expect, it } from "vitest";
import {
  buildFrontmatter,
  buildNote,
  parseFrontmatter,
  parseNote,
} from "../src/shared/utils/frontmatter";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { joinVaultPath, relativeVaultPath } from "../src/shared/utils/vault-path";

describe("buildFrontmatter", () => {
  it("serialises scalars and arrays in declaration order", () => {
    const fm = buildFrontmatter({
      type: "test-suite",
      id: "smoke",
      enabled: true,
      suites: ["smoke", "regression"],
    });
    expect(fm).toBe(
      [
        "---",
        "type: test-suite",
        "id: smoke",
        "enabled: true",
        "suites:",
        "  - smoke",
        "  - regression",
        "---",
      ].join("\n"),
    );
  });

  it("omits undefined fields and renders empty arrays inline", () => {
    const fm = buildFrontmatter({ a: undefined, b: [] });
    expect(fm).toBe(["---", "b: []", "---"].join("\n"));
  });

  it("quotes values that would otherwise be ambiguous YAML", () => {
    const fm = buildFrontmatter({ expr: "@smoke and not @wip", n: "123" });
    expect(fm).toContain('expr: "@smoke and not @wip"');
    expect(fm).toContain('n: "123"');
  });

  it("quotes a value with an interior newline so it can't split the scalar across lines", () => {
    const fm = buildFrontmatter({ title: "Login\nflow" });
    // Must be a single physical line (JSON-escaped), not two lines.
    expect(fm).toContain('title: "Login\\nflow"');
    expect(fm.split("\n").filter((l) => l.startsWith("title")).length).toBe(1);
    // And it round-trips back to the original through the parser.
    expect(parseFrontmatter(fm).title).toBe("Login\nflow");
  });

  it("buildNote joins frontmatter and body", () => {
    const note = buildNote({ id: "x" }, "# Title\n");
    expect(note.startsWith("---\nid: x\n---\n\n# Title")).toBe(true);
  });
});

describe("joinVaultPath", () => {
  it("joins, collapses duplicate slashes, and drops empty segments", () => {
    expect(joinVaultPath("Test Hub", "Getting Started.md")).toBe("Test Hub/Getting Started.md");
    // Leading slashes within a segment were previously silently collapsed, but since
    // joinVaultPath now rejects absolute segments (ADR-0019 / ADR-0008), use
    // vault-relative segments; the collapsing and empty-drop behaviour is unchanged.
    expect(joinVaultPath("a/", "b", "", "c")).toBe("a/b/c");
  });
});

describe("parseNote / parseFrontmatter", () => {
  it("round-trips a note produced by buildNote", () => {
    const note = buildNote(
      {
        type: "use-case",
        id: "UC-002",
        title: "Checkout: saved card",
        suites: ["smoke", "regression"],
        empty: [],
      },
      "# Body\n\nHello.",
    );
    const { frontmatter, body } = parseNote(note);
    expect(frontmatter).toEqual({
      type: "use-case",
      id: "UC-002",
      title: "Checkout: saved card", // quoted by the serialiser, unquoted here
      suites: ["smoke", "regression"],
      empty: [],
    });
    expect(body).toBe("# Body\n\nHello.");
  });

  it("returns an empty frontmatter when the note has no block", () => {
    expect(parseFrontmatter("# Just a heading")).toEqual({});
    expect(parseNote("# Just a heading").body).toBe("# Just a heading");
  });

  it("treats a key with no value or items as an empty string", () => {
    expect(parseFrontmatter("---\ndescription:\n---\n")).toEqual({ description: "" });
  });

  it("parses frontmatter with CRLF line endings", () => {
    const crlf = "---\r\ntype: use-case\r\nid: UC-001\r\nsuites:\r\n  - smoke\r\n---\r\n\r\n# Body";
    const { frontmatter, body } = parseNote(crlf);
    expect(frontmatter).toEqual({ type: "use-case", id: "UC-001", suites: ["smoke"] });
    expect(body).toBe("# Body");
  });
});

describe("relativeVaultPath", () => {
  it("computes the path from the runner folder to the feature folder", () => {
    expect(relativeVaultPath(vp(".testrunner"), vp("Specifications/features"))).toBe(
      "../Specifications/features",
    );
    expect(relativeVaultPath(vp("Tools/.testrunner"), vp("Specs/features"))).toBe(
      "../../Specs/features",
    );
  });

  it("handles a shared ancestor and identical paths", () => {
    expect(relativeVaultPath(vp("a/b"), vp("a/c"))).toBe("../c");
    expect(relativeVaultPath(vp("a"), vp("a"))).toBe(".");
  });
});
