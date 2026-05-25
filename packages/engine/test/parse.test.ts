import { describe, expect, it } from "vitest";
import { extractGherkinFence, parseGherkin } from "../src/gherkin/parse";

const NOTE = `# Login

Some documentation about the login flow.

\`\`\`gherkin
@smoke @auth
Feature: Login

  Background:
    Given the user opens "/login"

  Scenario: Valid credentials
    When the user fills "label=Email" with "a@b.co"
    And the user clicks "role=button[Sign in]"
    Then the page should show "Welcome"
\`\`\`

Trailing prose.
`;

describe("extractGherkinFence", () => {
  it("extracts the gherkin fence body", () => {
    const body = extractGherkinFence(NOTE);
    expect(body).toContain("Feature: Login");
    expect(body).toContain('Then the page should show "Welcome"');
  });

  it("returns null when there is no gherkin fence", () => {
    expect(extractGherkinFence("# Just notes\n")).toBeNull();
  });
});

describe("parseGherkin", () => {
  it("parses feature, tags, background and scenarios", () => {
    const feature = parseGherkin(extractGherkinFence(NOTE)!);
    expect(feature.name).toBe("Login");
    expect(feature.tags).toEqual(["@smoke", "@auth"]);
    expect(feature.background).toHaveLength(1);
    expect(feature.background[0].text).toBe('the user opens "/login"');
    expect(feature.scenarios).toHaveLength(1);
    expect(feature.scenarios[0].name).toBe("Valid credentials");
    expect(feature.scenarios[0].steps).toHaveLength(3);
  });

  it("throws when there is no Feature", () => {
    expect(() => parseGherkin("Scenario: orphan\n")).toThrow();
  });
});
