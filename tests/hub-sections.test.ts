import { describe, expect, it } from "vitest";
import {
  DEFAULT_HUB_SECTION,
  HUB_SECTIONS,
  HUB_SECTION_DESCRIPTORS,
  hubCrumbRoot,
  projectHubRail,
  readPersistedActiveSection,
  resolveActiveSection,
  type HubContentRef,
  type HubRail,
  type HubSectionDescriptor,
  type HubSectionId,
} from "../src/presentation/navigation/hub-sections";

/** The body ids a `section-body` content ref carries, in their rendered order. */
const bodiesOf = (section: HubSectionId): string[] =>
  HUB_SECTION_DESCRIPTORS[section].contents
    .filter((c): c is Extract<HubContentRef, { kind: "section-body" }> => c.kind === "section-body")
    .map((c) => c.body);

type LeafRef = Extract<HubContentRef, { kind: "leaf" }>;

/** The leaf content refs a section routes out to, in order. */
const leavesOf = (section: HubSectionId): LeafRef[] =>
  HUB_SECTION_DESCRIPTORS[section].contents.filter((c): c is LeafRef => c.kind === "leaf");

describe("HUB_SECTIONS", () => {
  it("lists the five sections in rail order, overview first", () => {
    expect([...HUB_SECTIONS]).toEqual(["overview", "plan", "build", "run", "review"]);
  });

  it("defaults the landing section to overview", () => {
    expect(DEFAULT_HUB_SECTION).toBe("overview");
  });
});

describe("HUB_SECTION_DESCRIPTORS", () => {
  it("has a descriptor for every section, keyed by its own id", () => {
    for (const id of HUB_SECTIONS) {
      const descriptor: HubSectionDescriptor = HUB_SECTION_DESCRIPTORS[id];
      expect(descriptor.id).toBe(id);
      expect(descriptor.label.length).toBeGreaterThan(0);
      expect(descriptor.ariaLabel.length).toBeGreaterThan(0);
    }
  });

  it("labels each section glossary-correctly", () => {
    expect(HUB_SECTIONS.map((id) => HUB_SECTION_DESCRIPTORS[id].label)).toEqual([
      "Overview",
      "Plan",
      "Build",
      "Run",
      "Review",
    ]);
  });

  it("assigns the decided Lucide icon to each section", () => {
    expect(HUB_SECTIONS.map((id) => HUB_SECTION_DESCRIPTORS[id].icon)).toEqual([
      "layout-dashboard",
      "git-fork",
      "file-check",
      "play",
      "gauge",
    ]);
  });

  it("hosts the overview KPI summary and recent runs as in-hub bodies", () => {
    expect(bodiesOf("overview")).toEqual(["kpi-overview", "recent-runs"]);
    expect(leavesOf("overview")).toEqual([]);
  });

  it("hosts the plan roadmap + story-map list as bodies; the board opens per-row, not as section content", () => {
    expect(bodiesOf("plan")).toEqual(["prd-roadmap", "story-maps"]);
    // A specific board is id-targeted — reached via the B4 navigate port from a
    // story-maps row, NOT a bare-viewType section leaf (Codex review).
    expect(leavesOf("plan")).toEqual([]);
  });

  it("hosts the build use-case list as a body; the detail opens per-row, not as section content", () => {
    expect(bodiesOf("build")).toEqual(["use-cases"]);
    expect(leavesOf("build")).toEqual([]);
  });

  it("hosts the run suites list as a body and the Test Console as a sidebar section leaf", () => {
    expect(bodiesOf("run")).toEqual(["suites"]);
    // The console must open in the SIDEBAR (openView defaults to main), so the
    // model carries the location, not just the view type (Codex review).
    expect(leavesOf("run")).toEqual([
      { kind: "leaf", viewType: "e2e-test-hub-console", location: "sidebar" },
    ]);
  });

  it("hosts the review evidence list as an in-hub body with no leaf", () => {
    expect(bodiesOf("review")).toEqual(["evidence"]);
    expect(leavesOf("review")).toEqual([]);
  });
});

describe("projectHubRail", () => {
  it("returns the five sections in rail order regardless of the active one", () => {
    const rail = projectHubRail("run");
    expect(rail.nodes.map((n) => n.descriptor.id)).toEqual([...HUB_SECTIONS]);
  });

  it("marks exactly the active section active for each section in turn", () => {
    for (const active of HUB_SECTIONS) {
      const rail: HubRail = projectHubRail(active);
      const activeIds = rail.nodes.filter((n) => n.active).map((n) => n.descriptor.id);
      expect(activeIds).toEqual([active]);
      expect(rail.active.id).toBe(active);
    }
  });

  it("resolves the active descriptor to the matching section descriptor", () => {
    const rail = projectHubRail("review");
    expect(rail.active).toBe(HUB_SECTION_DESCRIPTORS.review);
  });
});

describe("resolveActiveSection", () => {
  it("returns each known section unchanged", () => {
    for (const id of HUB_SECTIONS) {
      expect(resolveActiveSection(id)).toBe(id);
    }
  });

  it("falls back to overview for an unknown value", () => {
    expect(resolveActiveSection("settings")).toBe(DEFAULT_HUB_SECTION);
  });

  it("falls back to overview for undefined", () => {
    expect(resolveActiveSection(undefined)).toBe(DEFAULT_HUB_SECTION);
  });

  it("falls back to overview for an empty string", () => {
    expect(resolveActiveSection("")).toBe(DEFAULT_HUB_SECTION);
  });
});

describe("readPersistedActiveSection", () => {
  it("reads the activeSection string off a setState payload", () => {
    expect(readPersistedActiveSection({ activeSection: "run" })).toBe("run");
  });

  it("reads an unknown string through (resolveActiveSection sanitizes it)", () => {
    expect(readPersistedActiveSection({ activeSection: "settings" })).toBe("settings");
  });

  it("returns undefined when the field is absent", () => {
    expect(readPersistedActiveSection({})).toBeUndefined();
    expect(readPersistedActiveSection({ other: "x" })).toBeUndefined();
  });

  it("returns undefined for a non-string activeSection", () => {
    expect(readPersistedActiveSection({ activeSection: 3 })).toBeUndefined();
    expect(readPersistedActiveSection({ activeSection: null })).toBeUndefined();
    expect(readPersistedActiveSection({ activeSection: { nested: true } })).toBeUndefined();
  });

  it("returns undefined for a non-object / null / undefined state", () => {
    expect(readPersistedActiveSection(undefined)).toBeUndefined();
    expect(readPersistedActiveSection(null)).toBeUndefined();
    expect(readPersistedActiveSection("run")).toBeUndefined();
    expect(readPersistedActiveSection(42)).toBeUndefined();
  });

  it("composes with resolveActiveSection to land a known section or the default", () => {
    expect(resolveActiveSection(readPersistedActiveSection({ activeSection: "plan" }))).toBe(
      "plan",
    );
    expect(resolveActiveSection(readPersistedActiveSection({ activeSection: "nope" }))).toBe(
      DEFAULT_HUB_SECTION,
    );
    expect(resolveActiveSection(readPersistedActiveSection(null))).toBe(DEFAULT_HUB_SECTION);
  });
});

describe("hubCrumbRoot", () => {
  it("roots a trail at Test Hub › <Section> for each section", () => {
    expect(hubCrumbRoot("plan")).toEqual([{ label: "Test Hub" }, { label: "Plan" }]);
    expect(hubCrumbRoot("overview")).toEqual([{ label: "Test Hub" }, { label: "Overview" }]);
    expect(hubCrumbRoot("run")).toEqual([{ label: "Test Hub" }, { label: "Run" }]);
  });

  it("emits static label-only crumbs (no deep-link id)", () => {
    for (const crumb of hubCrumbRoot("build")) {
      expect(crumb.id).toBeUndefined();
      expect(crumb.kind).toBeUndefined();
    }
  });
});
