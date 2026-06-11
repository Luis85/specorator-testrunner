# Design: `.feature` file handler & structured Feature Editor

Date: 2026-06-11
Status: approved (design dialogue 2026-06-11)
Branch: `claude/repo-review-improvement-fa7b5s`

## Context

Two connected gaps in the Feature Specification authoring flow:

1. **`.feature` files cannot be opened inside Obsidian.** The extension is not
   registered, so Obsidian's file explorer hides the files and
   `WorkspacePort.openFile` → `leaf.openFile(TFile)` has no view to render
   them. The Use Case detail view's per-Feature "Open" button is therefore a
   dead end unless the user edits the file in an external editor.
2. **Nothing helps the user write *valid* Gherkin.** The starter Feature
   (UC-006) gives a skeleton, but from there the user hand-edits raw text and
   only learns about structural problems when they run Validate or the test
   itself fails.

Decisions made in the design dialogue:

- **Clicking a `.feature` file opens a structured Feature Editor** (not a
  plain text view with a separate editor surface). One view type, with a
  raw-text mode available inside it.
- **Extend the Gherkin parser/serializer to model full executable Gherkin**
  (Scenario Outline + Examples, data tables, doc strings, descriptions)
  rather than restricting the editor to the V1 subset.
- **All four authoring aids are in scope**: step autocomplete, inline
  validation + missing-step flags, tag picker, guided keyword flow.
- **Autosave, Obsidian-style** — no Save button; edits commit on blur/Enter
  and debounce-save through `TextFileView.requestSave()`.

## Part 1 — File handler registration

In `main.ts` (composition root):

- `registerView(FEATURE_EDITOR_VIEW_TYPE, (leaf) => new FeatureEditorView(leaf, deps))`
  with view type `e2e-test-hub-feature-editor`.
- `this.registerExtensions(["feature"], FEATURE_EDITOR_VIEW_TYPE)`.

Effects:

- `.feature` files become visible and clickable in the file explorer and the
  quick switcher.
- The existing detail-view "Open" button and post-generation `openFile` calls
  work unchanged — `leaf.openFile` now resolves to the registered view.
- Obsidian unregisters both automatically on plugin unload (`registerView` /
  `registerExtensions` are tracked by `Plugin`); no `onunload` work.

## Part 2 — Lossless Gherkin (domain + parser extension)

The V1 parser (`src/application/content/gherkin.ts`) skips Examples tables,
data tables, and doc-string bodies; a structured editor that saves through
`serialiseFeature` would silently delete them. The model is extended so the
parse → serialize round trip is lossless for executable Gherkin:

`src/domain/entities/specification.ts`:

- `GherkinStep` gains optional
  `dataTable?: string[][]` and
  `docString?: { fence: '"""' | "```"; mediaType?: string; lines: string[] }`.
- `ScenarioSpecification` gains
  `keyword: "Scenario" | "Scenario Outline"` and optional
  `examples?: ExamplesBlock[]` with
  `ExamplesBlock = { tags: string[]; name?: string; header: string[]; rows: string[][] }`.
- `FeatureSpecification` and `ScenarioSpecification` gain optional
  `description?: string[]` (the free-text lines under `Feature:` /
  `Scenario:`), required for lossless round-trip of real-world files.

`src/application/content/gherkin.ts`:

- `parseFeature` captures the new constructs instead of skipping them.
- `serialiseFeature` **moves here from `specification-service.ts`**, next to
  the parser: the round trip is now a load-bearing invariant and the two
  halves are tested together. `DefaultSpecificationService.update` imports it.
- New `roundTripsLosslessly(content, path): boolean` — parses, re-serializes,
  and compares against the original normalized line sequence (trailing
  whitespace stripped, blank-line runs collapsed).

**Deliberately NOT modeled**: comments (`#` lines) and `Rule:` blocks. The
round-trip guard exists precisely so unmodeled constructs degrade safely (see
Part 3) instead of being destroyed. Extending the model to `Rule:` is a
possible follow-up; comment preservation in a structured editor is out of
scope indefinitely.

## Part 3 — FeatureEditorView

`src/presentation/views/feature-editor-view.ts`, a `TextFileView` subclass.
The **raw text is the single source of truth** (`getViewData`/`setViewData`);
structured mode is a projection over it.

### Modes

- **Structured** (default): active when the file parses AND
  `roundTripsLosslessly` holds. Editing UI described below.
- **Raw text**: a plain text editor (textarea bound to the view data with
  debounced `requestSave`). Always reachable via a header toggle. Forced —
  with an explanatory banner ("this file contains Gherkin the structured
  editor can't preserve, e.g. comments or Rule: blocks") — when the guard
  fails. Switching raw → structured re-parses and re-runs the guard.

The structured editor can therefore never destroy file content.

### Structured mode layout

- **Feature header card**: name input, feature-level tag picker, description.
- **Background section**: step list (same step-row widget as scenarios).
- **Scenario cards**: keyword select (Scenario / Scenario Outline), name,
  tags, step list; an Examples grid editor (add/remove rows and columns,
  per-block tags) appears for Outlines.
- **Step rows**: keyword dropdown, text input, collapsed sub-editors for an
  optional data table (grid) and doc string (textarea + media type), move
  up/down and delete controls.
- Add buttons: + Step, + Scenario, + Examples block/row/column.

### Save flow

Edits commit on field blur/Enter → mutate the in-memory
`FeatureSpecification` → `serialiseFeature` → update the view's data →
`requestSave()` (Obsidian's debounced write). External modifications while
open follow normal `TextFileView` semantics (`setViewData` re-parses and
rebuilds the structured UI). After a successful save the view announces the
update (Part 4); `save()` is overridden to `await super.save()` then announce.

### Authoring aids

- **Step autocomplete**: while typing a step, suggest matching patterns from
  the scraped step definitions (`listStepPatterns`, Part 4). Cucumber
  expressions are shown as written (`{string}`, `{int}` placeholders read
  naturally); regex sources are shown as-is. A suggestion picked from the
  list is guaranteed to have an implementation.
- **Inline validation strip**: live structural validation over the in-memory
  spec using the same rules as `SpecificationService.validate` (feature has a
  name, ≥ 1 scenario, every scenario has steps, filename carries the ADR-0012
  `UC-NNN-` prefix — orphan is a warning, not a block), rendered with the
  wizard's ✓/✗/! checklist vocabulary. Per-step **missing-step flags** mark
  steps no definition matches; refreshed on open and after saves (debounced).
- **Tag picker**: tag inputs suggest the union of tags already used across
  the vault's Features (`listKnownTags`, Part 4), seeded with the `@wip` /
  `@smoke` conventions, while still accepting free text.
- **Guided keyword flow**: the add-step control proposes the keyword
  contextually — first step in a scenario defaults to `Given`, subsequent
  steps to `And` — so newcomers absorb Gherkin structure as they write.

Pure logic (spec mutations such as add/move/delete step and Examples-table
edits, guided-keyword choice, autocomplete matching, validation projection)
lives in `feature-editor-format.ts` / `feature-editor-rows.ts` following the
existing `test-console-format.ts` pattern, unit-testable without Obsidian.
Styles go in `styles.css` under the `e2e-test-hub-feature-editor-*` prefix.

## Part 4 — Service additions (narrow)

- `SpecificationService.announceUpdated(specification)`: publish-only
  `specification.updated` (no write — the view already saved through
  `TextFileView`). Keeps the event vocabulary in the application layer and
  keeps dashboards/explorers refreshing. Raw-mode saves announce only when
  the text parses.
- `SpecificationService.listStepPatterns()`: exposes the currently-private
  step-definition scraping (`loadStepDefinitions`) for autocomplete and the
  editor's missing-step flags. Same source as `detectMissingSteps`
  (`.testrunner/src/steps/**/*.ts`), so suggestions and flags agree.
- `FeatureInsightService.listKnownTags()`: union of feature- and
  scenario-level tags across `listFeatures()`, for the tag picker.

## Part 5 — Creation flow (unchanged)

`generate-feature-modal` / `createFromUseCase` remains the creation entry
point; ADR-0012 naming and UC back-linking are enforced there. The generated
file now simply opens in the Feature Editor. Files created outside the flow
(or renamed to lose the prefix) surface the orphan warning in the validation
strip.

## Error handling

- Unparseable or lossy files → raw-text mode with banner; never data loss.
- Save failures surface through Obsidian's standard write-error handling; the
  update announcement only fires after a successful `save()`.
- Step-pattern / known-tag loading failures degrade the aids silently
  (no suggestions, no flags) — they never block editing.

## Testing

- **Round-trip corpus** in `tests/gherkin.test.ts`: features with Outlines +
  multiple Examples blocks, data tables, doc strings (both fences, with media
  type), descriptions, tag combinations — `parse → serialize → parse` is
  stable and `roundTripsLosslessly` holds; files with comments or `Rule:`
  blocks fail the guard.
- **Editor logic**: unit tests over the pure `feature-editor-format` /
  `-rows` helpers (mutations, guided keyword, autocomplete matching,
  validation projection).
- **Service tests**: `announceUpdated` event shape, `listStepPatterns`
  parity with `detectMissingSteps`, `listKnownTags` union/dedupe.
- Existing `specification-service` and `feature-content` tests keep passing
  (serializer move is import-path only; starter content still round-trips).

## Implementation order (for the plan)

1. Domain + parser/serializer extension with round-trip tests (pure, no UI).
2. View registration + raw-text mode (smallest end-to-end win: `.feature`
   files open at all).
3. Structured mode core (header/scenario/step editing, autosave, guard).
4. Authoring aids (validation strip, autocomplete, tag picker, guided flow)
   + service additions.
