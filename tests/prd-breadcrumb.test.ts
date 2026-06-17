import { describe, expect, it } from "vitest";
import { prdBreadcrumbLabel } from "../src/presentation/views/use-case-detail-rows";

describe("prdBreadcrumbLabel", () => {
  const titles = new Map([["PRD-001", "Dashboard & KPI"]]);

  it("shows the domain and the PRD when both are present", () => {
    expect(prdBreadcrumbLabel({ domain: "Dashboard", prdId: "PRD-001" }, titles)).toBe(
      "Domain: Dashboard  ›  PRD-001: Dashboard & KPI",
    );
  });

  it("shows only the domain when there is no prdId", () => {
    expect(prdBreadcrumbLabel({ domain: "Dashboard" }, titles)).toBe("Domain: Dashboard");
  });

  it("returns an empty string when neither domain nor prdId is present", () => {
    expect(prdBreadcrumbLabel({}, titles)).toBe("");
  });

  it("falls back to the bare PRD id when its title is unknown", () => {
    expect(prdBreadcrumbLabel({ prdId: "PRD-009" }, titles)).toBe("PRD-009");
  });
});
