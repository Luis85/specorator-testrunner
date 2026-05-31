import type {
  FeatureSpecification,
  GherkinStep,
  ScenarioSpecification,
} from "../../domain/entities/specification";
import type { UseCaseId, VaultPath } from "../../domain/value-objects/identifiers";

/**
 * Minimal, I/O-free Gherkin parser for V1 (UC-006/UC-007, TIS §6.4–§6.6).
 *
 * It is not a full Gherkin engine: it recognises `Feature:`,
 * `Scenario:`/`Scenario Outline:`, tag lines (`@a @b`), and the step keywords
 * (Given/When/Then/And/But/*). Description lines, `Background`, `Examples`
 * tables, doc-strings and data tables are tolerated but not modelled — they are
 * simply skipped so a feature still parses. `useCaseId` is derived from the
 * filename prefix `UC-\d+` per ADR-0012, not from the file body.
 */

const STEP_KEYWORDS: ReadonlyArray<GherkinStep["keyword"]> = [
  "Given",
  "When",
  "Then",
  "And",
  "But",
  "*",
];

// ADR-0012: the filename must START with `<UC-id>-<slug>`, so anchor to the
// basename start — `archive-UC-1-old.feature` is an orphan, not UC-1.
const UC_PREFIX = /^(UC-\d+)-/i;

/** Extracts the leading `UC-NNN` prefix from a feature filename (ADR-0012). */
export const useCaseIdFromPath = (path: VaultPath): UseCaseId | null => {
  const base = path.split("/").pop() ?? path;
  const match = UC_PREFIX.exec(base);
  return match ? match[1].toUpperCase() : null;
};

/** Splits a `@a @b` tag line into individual tags (keeps the leading `@`). */
const parseTagLine = (line: string): string[] =>
  line
    .trim()
    .split(/\s+/)
    .filter((token) => token.startsWith("@"));

/** Matches a step line, returning the keyword and remaining text. */
const parseStep = (line: string): GherkinStep | null => {
  const trimmed = line.trim();
  for (const keyword of STEP_KEYWORDS) {
    if (keyword === "*") {
      if (trimmed.startsWith("* ")) {
        return { keyword: "*", text: trimmed.slice(2).trim() };
      }
      continue;
    }
    if (trimmed === keyword || trimmed.startsWith(`${keyword} `)) {
      return { keyword, text: trimmed.slice(keyword.length).trim() };
    }
  }
  return null;
};

const FEATURE_RE = /^Feature:\s*(.*)$/;
const SCENARIO_RE = /^Scenario(?:\s+Outline)?:\s*(.*)$/;
const BACKGROUND_RE = /^Background:/;

/**
 * Parses Gherkin `content` into a {@link FeatureSpecification}. Returns `null`
 * when the text has no `Feature:` line. `path` supplies the required
 * `useCaseId` (ADR-0012); when the filename carries no `UC-NNN` prefix the
 * `useCaseId` is left empty so the validator can flag it as an orphan.
 */
export const parseFeature = (content: string, path: VaultPath): FeatureSpecification | null => {
  const lines = content.split(/\r?\n/);

  let featureName: string | null = null;
  const featureTags: string[] = [];
  const scenarios: ScenarioSpecification[] = [];
  const background: GherkinStep[] = [];

  // Tags accumulate on the line(s) directly above a Feature/Scenario keyword.
  let pendingTags: string[] = [];
  // Steps flow into the current scenario, or the Background collector.
  let current: ScenarioSpecification | null = null;
  let inBackground = false;
  // Inside a `"""` / ``` ``` ``` doc string, lines are a step argument, not steps.
  let docStringFence: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();

    if (docStringFence !== null) {
      if (line === docStringFence) docStringFence = null; // closing fence
      continue; // doc-string body is an argument, never a step
    }
    if (line === '"""' || line === "```") {
      docStringFence = line;
      continue;
    }

    if (line === "" || line.startsWith("#")) continue;

    if (line.startsWith("@")) {
      pendingTags.push(...parseTagLine(line));
      continue;
    }

    const featureMatch = FEATURE_RE.exec(line);
    if (featureMatch) {
      featureName = featureMatch[1].trim();
      featureTags.push(...pendingTags);
      pendingTags = [];
      current = null;
      inBackground = false;
      continue;
    }

    // Background steps run before every scenario; collected separately so they
    // are checked by detectMissingSteps and round-trip as a `Background:` block.
    if (BACKGROUND_RE.test(line)) {
      current = null;
      inBackground = true;
      pendingTags = [];
      continue;
    }

    const scenarioMatch = SCENARIO_RE.exec(line);
    if (scenarioMatch) {
      current = {
        name: scenarioMatch[1].trim(),
        tags: pendingTags,
        steps: [],
      };
      scenarios.push(current);
      pendingTags = [];
      inBackground = false;
      continue;
    }

    const step = parseStep(line);
    if (step) {
      if (inBackground) {
        background.push(step);
        continue;
      }
      if (current) {
        current.steps.push(step);
        continue;
      }
    }

    // Anything else (descriptions, Examples, tables) is ignored, but a stray tag
    // block that did not attach to a keyword is discarded.
    pendingTags = [];
  }

  if (featureName === null) return null;

  return {
    path,
    useCaseId: useCaseIdFromPath(path) ?? "",
    featureName,
    tags: featureTags,
    ...(background.length > 0 ? { background } : {}),
    scenarios,
  };
};

/** Flattens every step text across a feature's Background + scenarios. */
export const collectStepTexts = (feature: FeatureSpecification): string[] => [
  ...(feature.background ?? []).map((step) => step.text),
  ...feature.scenarios.flatMap((scenario) => scenario.steps.map((step) => step.text)),
];
