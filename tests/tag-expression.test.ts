import { describe, expect, it } from "vitest";
import {
  matchesTags,
  parseTagExpression,
  type TagExpression,
} from "../src/domain/policies/tag-expression";

/** Parses or fails the test — for cases where the expression must be valid. */
const parse = (expression: string): TagExpression => {
  const result = parseTagExpression(expression);
  if (!result.ok) throw new Error(`expected "${expression}" to parse: ${result.error.message}`);
  return result.value;
};

const evaluate = (expression: string, tags: string[]): boolean =>
  matchesTags(parse(expression), tags);

describe("parseTagExpression", () => {
  it("parses the empty expression as match-everything (Cucumber semantics)", () => {
    expect(parse("")).toEqual({ kind: "all" });
    expect(parse("   \t ")).toEqual({ kind: "all" });
  });

  it("parses a single tag", () => {
    expect(parse("@smoke")).toEqual({ kind: "tag", tag: "@smoke" });
  });

  it("treats parentheses as their own tokens even when glued to a tag", () => {
    expect(parse("(@a or @b)")).toEqual(parse("( @a or @b )"));
  });

  describe("malformed expressions return err", () => {
    const cases: Array<[string, string]> = [
      ["@a and", "ends unexpectedly"],
      ["and @a", 'found "and"'],
      ["or", 'found "or"'],
      ["not", "ends unexpectedly"],
      ["(@a or @b", 'unclosed "('],
      ["@a)", 'Unexpected ")"'],
      ["()", 'found ")"'],
      ["@a @b", 'Unexpected "@b"'],
      ["@a not @b", 'Unexpected "not"'],
      ["@a and and @b", 'found "and"'],
    ];
    it.each(cases)("rejects %j", (expression, fragment) => {
      const result = parseTagExpression(expression);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION_FAILED");
        expect(result.error.message).toContain(fragment);
      }
    });
  });
});

describe("matchesTags", () => {
  it("matches a present tag and rejects an unknown tag", () => {
    expect(evaluate("@smoke", ["@smoke", "@demo"])).toBe(true);
    expect(evaluate("@regression", ["@smoke", "@demo"])).toBe(false);
  });

  it("the empty expression matches everything, including untagged scenarios", () => {
    expect(evaluate("", [])).toBe(true);
    expect(evaluate("", ["@anything"])).toBe(true);
  });

  it("is case-sensitive (Cucumber tags)", () => {
    expect(evaluate("@Smoke", ["@smoke"])).toBe(false);
    expect(evaluate("@smoke", ["@Smoke"])).toBe(false);
    expect(evaluate("@Smoke", ["@Smoke"])).toBe(true);
  });

  it("evaluates and / or / not", () => {
    expect(evaluate("@a and @b", ["@a", "@b"])).toBe(true);
    expect(evaluate("@a and @b", ["@a"])).toBe(false);
    expect(evaluate("@a or @b", ["@b"])).toBe(true);
    expect(evaluate("@a or @b", ["@c"])).toBe(false);
    expect(evaluate("not @wip", ["@smoke"])).toBe(true);
    expect(evaluate("not @wip", ["@wip"])).toBe(false);
  });

  it("binds not tighter than and: 'not @a and @b' is '(not @a) and @b'", () => {
    expect(evaluate("not @a and @b", ["@b"])).toBe(true);
    expect(evaluate("not @a and @b", ["@a", "@b"])).toBe(false);
    // Were it `not (@a and @b)`, ["@a"] alone would match.
    expect(evaluate("not @a and @b", ["@a"])).toBe(false);
  });

  it("binds and tighter than or: '@a or @b and @c' is '@a or (@b and @c)'", () => {
    expect(evaluate("@a or @b and @c", ["@a"])).toBe(true);
    expect(evaluate("@a or @b and @c", ["@b"])).toBe(false);
    expect(evaluate("@a or @b and @c", ["@b", "@c"])).toBe(true);
  });

  it("parentheses override precedence", () => {
    expect(evaluate("(@a or @b) and @c", ["@a"])).toBe(false);
    expect(evaluate("(@a or @b) and @c", ["@a", "@c"])).toBe(true);
    expect(evaluate("not (@a and @b)", ["@a"])).toBe(true);
    expect(evaluate("not (@a and @b)", ["@a", "@b"])).toBe(false);
  });

  it("supports double negation and chained operators", () => {
    expect(evaluate("not not @a", ["@a"])).toBe(true);
    expect(evaluate("not not @a", [])).toBe(false);
    expect(evaluate("@a and @b and @c", ["@a", "@b", "@c"])).toBe(true);
    expect(evaluate("@a and @b and @c", ["@a", "@b"])).toBe(false);
    expect(evaluate("@a or @b or @c", ["@c"])).toBe(true);
  });

  it("evaluates the seeded default suite expression '@smoke and not @wip'", () => {
    expect(evaluate("@smoke and not @wip", ["@smoke", "@demo"])).toBe(true);
    expect(evaluate("@smoke and not @wip", ["@smoke", "@wip"])).toBe(false);
    expect(evaluate("@smoke and not @wip", ["@demo"])).toBe(false);
  });

  it("ignores duplicate tags in the scenario list", () => {
    expect(evaluate("@a and not @b", ["@a", "@a"])).toBe(true);
  });
});
