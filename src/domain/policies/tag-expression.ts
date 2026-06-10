import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";

/**
 * Cucumber tag-expression evaluator (Wave F insight; AD-4 / CONTEXT.md "Tag
 * Expression"). A Test Suite's Tag Expression IS its membership, and the runner
 * resolves it via Cucumber's `--tags` — but the Test Hub itself never evaluated
 * one, so dashboards could not show how many scenarios a suite actually
 * matches. This pure policy implements the documented Cucumber grammar:
 *
 *   expression := or
 *   or         := and ("or" and)*
 *   and        := unary ("and" unary)*
 *   unary      := "not" unary | "(" expression ")" | tag
 *
 * Precedence is `not` > `and` > `or`; parentheses override. Tags are
 * case-sensitive (Cucumber semantics: `@Smoke` ≠ `@smoke`); the operators
 * `and` / `or` / `not` are the lowercase reserved words. An EMPTY (or
 * whitespace-only) expression matches every scenario, mirroring how an empty
 * `--tags` filters nothing. Cucumber's `\(`-style escapes are not supported in
 * V1 (no shipped content uses them).
 *
 * Pure domain logic: no I/O, unit-testable in isolation (BBV §10). This module
 * is INSIGHT-only — runs still pass the expression verbatim to Cucumber
 * (AD-4), which stays authoritative for execution-time membership.
 */

/** Parsed tag-expression AST. `all` is the empty expression (matches everything). */
export type TagExpression =
  | { readonly kind: "all" }
  | { readonly kind: "tag"; readonly tag: string }
  | { readonly kind: "not"; readonly operand: TagExpression }
  | { readonly kind: "and"; readonly left: TagExpression; readonly right: TagExpression }
  | { readonly kind: "or"; readonly left: TagExpression; readonly right: TagExpression };

type Token = "(" | ")" | "and" | "or" | "not" | { readonly tag: string };

const tokenLabel = (token: Token): string => (typeof token === "string" ? token : token.tag);

/**
 * Splits the expression into parens + whitespace-separated words. Parentheses
 * are their own tokens even when glued to a tag — `(@a or @b)` tokenizes the
 * same as `( @a or @b )`, matching Cucumber's tokenizer.
 */
const tokenize = (expression: string): Token[] => {
  const tokens: Token[] = [];
  let word = "";
  const flush = (): void => {
    if (word === "") return;
    tokens.push(word === "and" || word === "or" || word === "not" ? word : { tag: word });
    word = "";
  };
  for (const char of expression) {
    if (/\s/.test(char)) {
      flush();
    } else if (char === "(" || char === ")") {
      flush();
      tokens.push(char);
    } else {
      word += char;
    }
  }
  flush();
  return tokens;
};

/** Internal parse failure; converted to a `Result` error at the boundary. */
class TagExpressionParseError extends Error {}

const fail = (message: string): never => {
  throw new TagExpressionParseError(message);
};

/**
 * Parses a Cucumber tag expression into a {@link TagExpression}. Returns a
 * VALIDATION_FAILED error naming the structural problem for malformed input
 * (dangling operator, unbalanced parentheses, two adjacent operands, …).
 */
export const parseTagExpression = (expression: string): Result<TagExpression> => {
  if (expression.trim() === "") return ok({ kind: "all" });

  const tokens = tokenize(expression);
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];

  const parseUnary = (): TagExpression => {
    const token = peek();
    if (token === undefined) {
      return fail('Tag Expression ends unexpectedly — expected a tag, "not", or "(".');
    }
    if (token === "not") {
      pos += 1;
      return { kind: "not", operand: parseUnary() };
    }
    if (token === "(") {
      pos += 1;
      const inner = parseOr();
      if (peek() !== ")") return fail('Tag Expression has an unclosed "(".');
      pos += 1;
      return inner;
    }
    if (token === ")" || token === "and" || token === "or") {
      return fail(`Expected a tag but found "${tokenLabel(token)}".`);
    }
    pos += 1;
    return { kind: "tag", tag: token.tag };
  };

  const parseAnd = (): TagExpression => {
    let left = parseUnary();
    while (peek() === "and") {
      pos += 1;
      left = { kind: "and", left, right: parseUnary() };
    }
    return left;
  };

  const parseOr = (): TagExpression => {
    let left = parseAnd();
    while (peek() === "or") {
      pos += 1;
      left = { kind: "or", left, right: parseAnd() };
    }
    return left;
  };

  try {
    const parsed = parseOr();
    const leftover = peek();
    if (leftover !== undefined) {
      return fail(`Unexpected "${tokenLabel(leftover)}" in Tag Expression.`);
    }
    return ok(parsed);
  } catch (error) {
    if (error instanceof TagExpressionParseError) {
      return err(appError("VALIDATION_FAILED", error.message));
    }
    throw error; // programmer error — never swallow
  }
};

/**
 * Evaluates a parsed expression against a scenario's (effective) tag list.
 * Matching is exact and case-sensitive per Cucumber; an unknown tag simply
 * does not match. Duplicate tags in the list are harmless (set membership).
 */
export const matchesTags = (expression: TagExpression, tags: string[]): boolean => {
  switch (expression.kind) {
    case "all":
      return true;
    case "tag":
      return tags.includes(expression.tag);
    case "not":
      return !matchesTags(expression.operand, tags);
    case "and":
      return matchesTags(expression.left, tags) && matchesTags(expression.right, tags);
    case "or":
      return matchesTags(expression.left, tags) || matchesTags(expression.right, tags);
  }
};
