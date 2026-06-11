# Design: Guided Tour — interactive, learning-by-doing onboarding

Date: 2026-06-11
Status: approved (design dialogue 2026-06-11)
Branch: `claude/interactive-plugin-onboarding-phq47j`

## Context

Onboarding today ends where it starts: the **Initialization Wizard** scaffolds
the vault, ships the UC-001 demo (ADR-0009), and points at a static
**Getting Started** note. Nothing afterwards is interactive, and the user never
*authors* anything — the demo is pre-built.

Goal: an interactive, learning-by-doing onboarding that walks the user through
**all aspects of the plugin** — Use Case, Feature, Gherkin authoring,
validation, missing-step detection, step definitions, Suites, Test Runs,
Evidence, and CI — ending with a **first testable demo created by the user
themselves**.

Design decisions made in the dialogue:

1. **Surface:** a persistent **guided-tour panel** (an Obsidian `ItemView` with
   a live step checklist), not a wizard modal and not a passive Markdown note.
   The user performs each step in the real plugin UI; the tour observes the
   EventBus and auto-advances.
2. **Scope:** the **full V1 loop including CI** (CI as an optional final step).
3. **Demo content:** the shipped UC-001 demo **stays untouched** (ADR-0009
   remains the 5-minute smoke check and worked example); the tour guides the
   user to author a *second*, genuinely new test against the local fixture.
4. **Authoring depth:** the fixture page is **extended with a second
   interaction** (a greeting form) so the user's scenario exercises new
   behavior and writes one new step-definition file — making missing-step
   detection and step-definition generation (EPIC-005 flagships) find
   something real. The TypeScript step is skippable for non-technical users.
5. **Eventing:** tour progress **publishes domain events** (`tour.*`) on the
   EventBus, consistent with the event-driven architecture — not a
   service-private callback.

## Terminology

**Guided Tour** — the new concept; gets a CONTEXT.md glossary entry. Distinct
from the **Initialization Wizard** (whose glossary entry explicitly avoids
"onboarding flow"; that stays true — the wizard scaffolds, the tour teaches).

## The steps

Ten steps, presented in order. Completion is event-observed, so steps a user
performs out of order (or before ever opening the tour view) are honored.

| #  | Step                          | The user does                                                                          | Auto-completed by                                                              | Skippable |
| -- | ----------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------- |
| 1  | See green first               | Run the shipped demo test (ADR-0009)                                                    | `testrun.completed` with `passed`                                              | yes       |
| 2  | Create your Use Case          | **New Use Case** — suggested title "Greet the visitor"                                  | `usecase.created` with `useCaseId !== "UC-001"`                                | no        |
| 3  | Generate a Feature            | **Generate Feature from Use Case** for the new Use Case                                 | `specification.linkedToUseCase` with non-demo `useCaseId`                      | no        |
| 4  | Author the Gherkin            | Replace the scaffold body with the tour's provided scenario (tagged `@tour`), then **Validate Feature** | `specification.validation.completed` with `valid: true` for a non-demo feature | no        |
| 5  | Detect missing steps          | **Detect Missing Steps** — finds the 3 new steps                                        | `specification.missingSteps.detected` with `missing.length > 0`                | yes       |
| 6  | Generate + implement steps    | **Generate Step Definitions**, paste the provided implementation, re-detect → 0 missing | `stepdefinition.generated`, then `specification.missingSteps.detected` with `missing.length === 0` | yes       |
| 7  | Create a Test Suite           | **New Test Suite** — name "Tour", tag expression `@tour`                                | `suite.created` with a non-default suite id (not `smoke`/`regression`)         | no        |
| 8  | Run your own test             | Run the Tour suite; watch the Test Console stream                                       | `testrun.completed` with `passed`, occurring after step 7 is complete          | no        |
| 9  | Review the Evidence           | Open the run's Evidence note                                                            | `evidence.generated` arms the step; completion is a manual **Mark done** (opening a note publishes no event) | yes       |
| 10 | Ship it to CI                 | **Generate CI Workflow**, then **Check CI Readiness**                                   | `ci.pipeline.generated`                                                        | yes       |

Notes on the table:

- Steps 1, 5, 6, 9, 10 are skippable; 2, 3, 4, 7, 8 are the authoring spine
  and are not (skipping them would leave nothing to run).
- Step 6's two-phase rule: the step is *progressed* by
  `stepdefinition.generated` and *completed* by a subsequent
  zero-missing detection. If the user skips step 6 without implementing, step 8
  will fail at runtime — the tour does not pretend otherwise; the step-8 row
  carries a hint that undefined steps fail the run.
- Predicates exclude artifacts created by initialization itself (UC-001, the
  demo feature, the `smoke`/`regression` default suites) so re-running the
  wizard or a UC-024 reset cannot silently complete tour steps.
- Step 8's "after step 7" ordering guard prevents the demo run from step 1
  double-counting as the user's own run.

## Fixture extension (enables genuine authoring)

`EXAMPLE_HTML` in `src/infrastructure/runner/templates/runner-templates.ts`
(written with `overwrite: true`, so it propagates to existing installs via
**Repair Installation**) gains a second interaction below the existing
Continue button:

- a text input `#name` (labelled "Name"),
- a button `#greet` ("Greet"),
- a div `#greeting` that renders `Hello, <name>!` on click.

The user's scenario (provided as a copy-paste snippet in step 4):

```gherkin
@tour
Feature: Greet the visitor
  Scenario: Greeting shows the entered name
    Given I open the local example page
    When I enter "Ada" into the name field
    And I submit the greeting
    Then the greeting should say "Hello, Ada!"
```

The three new steps (`I enter {string} into the name field`,
`I submit the greeting`, `the greeting should say {string}`) deliberately
**do not collide** with the shipped step patterns in `example.steps.ts` —
that file is user-owned (`overwrite: false`) and cannot be updated on existing
installs, and duplicate Cucumber patterns would be ambiguous. Only `Given I
open the local example page` is reused. The step-6 snippet provides the full
implementation (a `GreetingSection` interaction via the existing
`ExamplePage`/`fixtureUrl` idioms) to paste into the generated scaffold.

## Architecture

Follows the existing layering (eslint layer-boundary rules apply).

### Domain

- `src/domain/onboarding/tour-steps.ts` — the step table as **pure data**:
  `TourStepDefinition { id, title, teach, action?, snippets?, completion,
  skippable }` where `completion` is either
  `{ kind: "event"; type: DomainEventType; predicate(payload, ctx): boolean }`
  (a pure function), `{ kind: "event-sequence"; rules: EventRule[] }` (each
  rule must match once, in order — step 6's `stepdefinition.generated` followed
  by a zero-missing detection), or `{ kind: "manual" }`. Cross-step ordering
  (step 8 counts only after step 7) is `requiresCompleted?: TourStepId[]`.
- `src/domain/settings/settings.ts` — new `OnboardingSettings` section on
  `TestHubSettings`:
  `onboarding: { tourId: string | null; completedSteps: TourStepId[];
  skippedSteps: TourStepId[]; dismissed: boolean }` with defaults
  (`tourId: null`, empty arrays, `false`). Stored in `data.json` via the
  existing `SettingsService`, so **UC-024 reset clears tour progress for
  free**. `SettingsService` load-sanitization is extended for the new section
  (unknown step ids are dropped on load).

### Application

- `src/application/services/guided-tour-service.ts` — `GuidedTourService`
  (`DefaultGuidedTourService(settingsService, eventBus, logger)`):
  - subscribes (in `main.ts` composition root, so progress is tracked whether
    or not the view is open) to the event types referenced by the step table;
  - evaluates predicates against the payload plus a context of known demo
    artifact ids (`DEMO_USE_CASE_ID`, demo feature path, default suite ids);
  - on first relevant completion with `tourId === null`, mints a tour id and
    publishes `tour.started`;
  - persists progress via `SettingsService.save` and publishes
    `tour.step.completed` / `tour.step.skipped`; when the last non-skipped
    step completes, publishes `tour.completed`;
  - exposes `getState(): TourState` (step list with statuses
    `pending | active | done | skipped`, where *active* = first incomplete),
    `markDone(stepId)` (manual steps only), `skip(stepId)`, and
    `restart()` (clears progress, mints a new tour id, publishes
    `tour.started`).

### Domain events (Event Catalog addition)

New `DomainEventType` members, documented in
`docs/architecture/Event Catalog.md` with the standard envelope:

| Event                 | Payload                                            |
| --------------------- | -------------------------------------------------- |
| `tour.started`        | `{ tourId: string }`                                |
| `tour.step.completed` | `{ tourId: string; stepId: string; via: "event" \| "manual" }` |
| `tour.step.skipped`   | `{ tourId: string; stepId: string }`                |
| `tour.completed`      | `{ tourId: string }`                                |

Correlation rule (Catalog §19 style): `correlationId = tourId` for the whole
tour traversal, mirroring how the wizard uses its invocation id.
`causationId` on `tour.step.completed` is the id of the triggering domain
event when `via: "event"`.

### Presentation

- `src/presentation/views/guided-tour-view.ts` — `GuidedTourView`
  (`ItemView`, view type `e2e-test-hub-guided-tour`), opened in the **right
  sidebar** (peer of the Test Console — it must stay visible while the user
  works in the main area). Re-renders on `tour.*` events via the EventBus,
  initial render from `GuidedTourService.getState()`.
- `src/presentation/views/guided-tour-rows.ts` — pure row-projection functions
  (the `dashboard-rows.ts` pattern): step status icon, title, teach text,
  action button label/command, snippet blocks, Skip / Mark done affordances.
  The active step renders expanded; done/skipped steps collapse to one line.
  Snippet blocks get a **Copy** button.
- Action buttons invoke the same code paths as the existing commands/modals
  (New Use Case modal, Generate Feature modal, run pickers, etc.) — the tour
  never reimplements an action.
- Entry points:
  - **"Start guided tour"** CTA button on the Initialization Wizard's success
    screen (next to "Open Getting Started");
  - **"Open Guided Tour"** command in `register-commands.ts`;
  - a dashboard quick action ("Continue the guided tour") shown while the
    tour is neither completed nor dismissed;
  - **Dismiss** (sets `dismissed: true`, hides the dashboard CTA; the command
    always reopens) and **Restart tour** inside the view.

## Error handling

- The tour never blocks the plugin. A failing action surfaces its error in the
  existing UI (Test Console, modal, Notice); the step stays incomplete and the
  active-step body links to the generated **Troubleshooting** note.
- Settings-persistence failure on completion degrades to in-memory progress
  for the session plus a Notice (consistent with existing save-failure
  handling); the next successful save re-persists the full state.
- Event-handler errors are already isolated by the EventBus (a throwing
  subscriber cannot break publishers); predicates are pure and defensive
  against malformed payloads (unknown shapes simply don't match).

## Testing

- **Domain:** the step table and every completion predicate are pure —
  unit-tested directly (demo-artifact exclusions, step-6 two-phase, step-8
  ordering, unknown-payload safety).
- **Application:** `DefaultGuidedTourService` against the existing in-memory
  EventBus and settings stubs (`tests/__stubs__`): event → completion →
  persistence → published `tour.*` event chains; restart; manual/skip paths;
  sanitization of persisted unknown step ids.
- **Presentation:** `guided-tour-rows.ts` projections unit-tested like
  `dashboard-rows`.
- Coverage gate (NFR-002, ≥ 80%) respected.

## Documentation updates

- **CONTEXT.md** — new glossary entry **Guided Tour** (avoid: tutorial,
  walkthrough, onboarding wizard) and a note distinguishing it from the
  Initialization Wizard.
- **ADR-0020** — "Event-observed Guided Tour for onboarding": records the
  panel-over-modal decision, ADR-0009 preservation, and the choice to publish
  `tour.*` domain events.
- **Event Catalog** — new §"Tour Events" (envelope, payloads, correlation
  rule) and the `DomainEventType` extension.
- **Generated docs** (`documentation-content.ts`) — the Getting Started note's
  "Your first test" section gains a "Take the Guided Tour" pointer; the index
  doc lists the tour as the recommended path after initialization.

## Out of scope (YAGNI)

- No scenario-level tracking (Scenario Reference stays deferred).
- No multi-tour framework — exactly one tour, one step table.
- No telemetry; `tour.*` events are in-process only, like all others.
- No changes to `example.steps.ts` shipped content, the demo Use Case, or
  ADR-0009 behavior.
